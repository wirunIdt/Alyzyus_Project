"""Strict mutation validators; browser totals are never trusted."""
import math
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit
from uuid import UUID

from flask import request
from werkzeug.exceptions import BadRequest

from .errors import ApiError


def read_json() -> dict:
    if request.content_length and request.content_length > 64 * 1024:
        raise ApiError("PAYLOAD_TOO_LARGE", 413)
    if request.mimetype != "application/json":
        raise ApiError("INVALID_CONTENT_TYPE", 415)
    raw = request.get_data(cache=True)
    if len(raw) > 64 * 1024:
        raise ApiError("PAYLOAD_TOO_LARGE", 413)
    try:
        return object_fields(request.get_json(), None)
    except BadRequest as exc:
        raise ApiError("INVALID_INPUT") from exc


def object_fields(value, allowed: set | None, required: set = frozenset()) -> dict:
    if not isinstance(value, dict) or (allowed is not None and set(value) - allowed) or required - set(value):
        raise ApiError("INVALID_INPUT")
    return value


def string(value, minimum=0, maximum=4000) -> str:
    if not isinstance(value, str):
        raise ApiError("INVALID_INPUT")
    value = value.strip()
    if not minimum <= len(value) <= maximum or "\x00" in value:
        raise ApiError("INVALID_INPUT")
    return value


def uuid(value) -> str:
    value = string(value, 36, 36)
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise ApiError("INVALID_INPUT") from exc


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ApiError("INVALID_INPUT")
    return value


def money(value, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ApiError("INVALID_INPUT")
    try:
        amount = Decimal(str(value))
        if not 0 <= amount <= 10000000 or (positive and amount <= 0) or amount != amount.quantize(Decimal("0.01")):
            raise ApiError("INVALID_INPUT")
    except InvalidOperation as exc:
        raise ApiError("INVALID_INPUT") from exc
    return float(amount)


def email(value):
    value = string(value, 3, 254).lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise ApiError("INVALID_INPUT")
    return value


def password(value, new=False):
    if not isinstance(value, str) or not (12 if new else 1) <= len(value) <= 256:
        raise ApiError("INVALID_INPUT")
    return value


def localized(value):
    value = object_fields(value, {"th", "en", "zh"}, {"th", "en", "zh"})
    return {key: string(value[key], 1, 4000) for key in ("th", "en", "zh")}


def checkout(value):
    value = object_fields(value, {"items", "customer", "paymentMethod", "coupon", "idempotencyKey"}, {"items", "customer", "paymentMethod", "idempotencyKey"})
    if not isinstance(value["items"], list) or not 1 <= len(value["items"]) <= 50:
        raise ApiError("INVALID_CART")
    items = []
    for item in value["items"]:
        item = object_fields(item, {"productId", "quantity"}, {"productId", "quantity"})
        items.append({"productId": uuid(item["productId"]), "quantity": integer(item["quantity"], 1, 99)})
    if len({item["productId"] for item in items}) != len(items):
        raise ApiError("INVALID_CART")
    customer = object_fields(value["customer"], {"name", "email", "phone", "address"}, {"name", "email", "phone", "address"})
    phone = string(customer["phone"], 8, 30)
    if not re.fullmatch(r"[+()\d\s-]+", phone):
        raise ApiError("INVALID_INPUT")
    method = value["paymentMethod"]
    if method not in ("cod", "bank_transfer", "card", "promptpay"):
        raise ApiError("INVALID_PAYMENT")
    return {
        "items": items,
        "customer": {"name": string(customer["name"], 2, 120), "email": email(customer["email"]), "phone": phone, "address": string(customer["address"], 10, 1000)},
        "paymentMethod": method, "coupon": string(value.get("coupon", ""), 0, 30).upper(),
        "idempotencyKey": uuid(value["idempotencyKey"]),
    }


def product(value, partial=False):
    allowed = {"id", "slug", "name", "description", "category", "price", "compareAt", "stock", "images", "colors", "featured", "badge", "active"}
    required = {"id"} if partial else {"slug", "name", "description", "category", "price", "stock", "images", "colors"}
    value = object_fields(value, allowed, required)
    if partial and len(value) < 2:
        raise ApiError("INVALID_INPUT")
    result = {}
    for key, item in value.items():
        if key == "id": result[key] = uuid(item)
        elif key == "slug":
            result[key] = string(item, 2, 100)
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", result[key]): raise ApiError("INVALID_INPUT")
        elif key in ("name", "description"): result[key] = localized(item)
        elif key == "category": result[key] = string(item, 2, 40)
        elif key == "price": result[key] = money(item, positive=True)
        elif key == "compareAt": result[key] = None if item is None else money(item)
        elif key == "stock": result[key] = integer(item, 0, 1000000)
        elif key in ("featured", "active"):
            if type(item) is not bool: raise ApiError("INVALID_INPUT")
            result[key] = item
        elif key == "badge":
            if item not in (None, "new", "bestseller"): raise ApiError("INVALID_INPUT")
            result[key] = item
        elif key == "images":
            if not isinstance(item, list) or not 1 <= len(item) <= 10: raise ApiError("INVALID_INPUT")
            result[key] = [string(image, 1, 2048) for image in item]
            for image in result[key]:
                parsed = urlsplit(image)
                if not (image.startswith("/") and not image.startswith("//")) and not (parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password):
                    raise ApiError("INVALID_INPUT")
        elif key == "colors":
            if not isinstance(item, list) or len(item) > 20: raise ApiError("INVALID_INPUT")
            result[key] = [string(color, 1, 30) for color in item]
    return result


def order_patch(value):
    value = object_fields(value, {"id", "status", "tracking_number", "carrier", "payment_status"}, {"id"})
    if len(value) < 2: raise ApiError("INVALID_INPUT")
    result = {"id": uuid(value["id"])}
    if "status" in value:
        if value["status"] not in ("pending", "confirmed", "processing", "shipped", "delivered", "cancelled"): raise ApiError("INVALID_INPUT")
        result["status"] = value["status"]
    if "payment_status" in value:
        if value["payment_status"] != "paid": raise ApiError("INVALID_INPUT")
        result["payment_status"] = "paid"
    for key, maximum in (("tracking_number", 100), ("carrier", 80)):
        if key in value: result[key] = string(value[key], 0, maximum)
    return result
