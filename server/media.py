"""Admin-only product media and translation, separate from order processing."""
import html
import io
import time
import warnings
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from uuid import uuid4

import httpx
from flask import Blueprint, current_app, jsonify, request
from PIL import Image, ImageOps, UnidentifiedImageError

from .auth import require_admin
from .config import commerce_configured
from .database import db
from .errors import ApiError
from .validation import object_fields, read_json, string

bp = Blueprint("media", __name__)
BUCKET = "product-images"
MAX_IMAGE_BYTES = 850_000
MAX_PIXELS = 12_000_000
LOCALES = ("th", "en", "zh")
TRANSLATION_URL = "https://api.mymemory.translated.net/get"
_cache = OrderedDict()
_cache_lock = Lock()


def optimized_image(raw: bytes) -> bytes:
    """ตรวจไฟล์จริงก่อนแปลงเป็น WebP และลบ EXIF/metadata เพื่อให้เบาและปลอดภัย"""
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ApiError("IMAGE_TOO_LARGE", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ("JPEG", "PNG", "WEBP") or source.width * source.height > MAX_PIXELS:
                    raise ApiError("INVALID_IMAGE", 400)
                source.load()
                image = ImageOps.exif_transpose(source)
                image.thumbnail((1600, 1600))
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                target = io.BytesIO()
                image.save(target, format="WEBP", quality=82, method=3)
                return target.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ApiError("INVALID_IMAGE", 400) from exc


def storage_request(method, endpoint, *, body=None, content=None):
    config = current_app.config
    key = config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Cookie": "", "Accept": "application/json"}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    if content is not None:
        headers.update({"Content-Type": "image/webp", "Cache-Control": "31536000", "x-upsert": "false"})
    try:
        return db().client.request(method, config["SUPABASE_URL"] + "/storage/v1/" + endpoint, headers=headers, json=body, content=content, timeout=15)
    except httpx.HTTPError as exc:
        raise ApiError("UPLOAD_UNAVAILABLE", 503) from exc


@bp.post("/api/admin/images")
def upload_image():
    require_admin()
    if not commerce_configured(current_app.config):
        raise ApiError("STORE_NOT_CONFIGURED", 503)
    if set(request.files) != {"file"} or len(request.files.getlist("file")) != 1:
        raise ApiError("INVALID_IMAGE", 400)
    data = optimized_image(request.files["file"].stream.read(MAX_IMAGE_BYTES + 1))
    # สร้าง bucket ผ่าน Storage API ไม่แก้ตาราง storage.objects โดยตรง
    bucket = storage_request("GET", "bucket/" + BUCKET)
    if bucket.status_code == 404 or (bucket.status_code == 400 and "not found" in bucket.text.lower()):
        created = storage_request("POST", "bucket", body={"id": BUCKET, "name": BUCKET, "public": True, "file_size_limit": MAX_IMAGE_BYTES, "allowed_mime_types": ["image/webp"]})
        if created.is_error and created.status_code not in (409,):
            # Concurrent first uploads may both attempt to create the bucket.
            if storage_request("GET", "bucket/" + BUCKET).is_error:
                raise ApiError("UPLOAD_UNAVAILABLE", 503)
    elif bucket.is_error:
        raise ApiError("UPLOAD_UNAVAILABLE", 503)
    name = "products/" + uuid4().hex + ".webp"
    response = storage_request("POST", "object/" + BUCKET + "/" + name, content=data)
    if response.is_error:
        raise ApiError("UPLOAD_UNAVAILABLE", 503)
    return jsonify(url=current_app.config["SUPABASE_URL"] + "/storage/v1/object/public/" + BUCKET + "/" + name, size=len(data)), 201


def translation_chunks(text, byte_limit=480):
    """แบ่งข้อความตามวรรคเมื่อทำได้ และไม่ตัดไบต์ UTF-8 หรือเครื่องหมายภาษาไทย"""
    remaining = text
    chunks = []
    while remaining:
        end = 0
        used = 0
        for char in remaining:
            length = len(char.encode("utf-8"))
            if used + length > byte_limit:
                break
            used += length
            end += 1
        if end < len(remaining):
            # Avoid splitting before a Thai combining vowel/tone.
            while end > 1 and remaining[end] in "ัิีึืุู็่้๊๋์ํ":
                end -= 1
            boundary = max(remaining.rfind(" ", 0, end), remaining.rfind("\n", 0, end), remaining.rfind(". ", 0, end))
            if boundary > end // 2:
                end = boundary + 1
        chunks.append(remaining[:end])
        remaining = remaining[end:]
    return chunks


def translate_text(client, value, source, target, deadline=None):
    key = (value, source, target)
    with _cache_lock:
        found = _cache.get(key)
        if found and found[0] > time.monotonic():
            _cache.move_to_end(key)
            return found[1]
    parts = []
    for chunk in translation_chunks(value):
        if deadline is not None and time.monotonic() > deadline:
            raise ApiError("TRANSLATION_UNAVAILABLE", 503)
        try:
            pair = ("zh-CN" if source == "zh" else source) + "|" + ("zh-CN" if target == "zh" else target)
            response = client.get(TRANSLATION_URL, params={"q": chunk.strip(), "langpair": pair}, headers={"Cookie": "", "Accept": "application/json"}, timeout=8)
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ApiError("TRANSLATION_UNAVAILABLE", 503) from exc
        if response.is_error or data.get("quotaFinished") or data.get("responseStatus") != 200:
            raise ApiError("TRANSLATION_UNAVAILABLE", 503)
        translated = data.get("responseData", {}).get("translatedText")
        if not isinstance(translated, str) or not translated.strip():
            raise ApiError("TRANSLATION_UNAVAILABLE", 503)
        parts.append(html.unescape(translated.strip()))
    result = " ".join(parts)
    with _cache_lock:
        _cache[key] = (time.monotonic() + 3600, result)
        _cache.move_to_end(key)
        while len(_cache) > 128:
            _cache.popitem(last=False)
    return result


@bp.post("/api/admin/translate")
def translate_product():
    require_admin()
    value = object_fields(read_json(), {"source", "name", "description"}, {"source", "name", "description"})
    source = value["source"]
    if source not in LOCALES:
        raise ApiError("INVALID_INPUT")
    name = string(value["name"], 1, 180)
    description = string(value["description"], 1, 4000)
    localized = {"name": {source: name}, "description": {source: description}}
    jobs = [(field, text, target) for field, text in (("name", name), ("description", description)) for target in LOCALES if target != source]
    # เพียงสองงานพร้อมกัน ไม่สร้าง thread ตามความยาวของข้อความ
    client = db().client
    deadline = time.monotonic() + 25
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [(field, target, executor.submit(translate_text, client, text, source, target, deadline)) for field, text, target in jobs]
        for field, target, future in futures:
            result = future.result()
            if len(result) > (180 if field == "name" else 4000):
                raise ApiError("TRANSLATION_TOO_LONG", 400)
            localized[field][target] = result
    return jsonify(**localized, provider="MyMemory", reviewRequired=True)
