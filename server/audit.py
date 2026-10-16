"""บันทึกกิจกรรมที่ตรวจสอบได้ โดยไม่เก็บรหัสผ่าน โทเค็น หรือข้อมูลจัดส่ง"""

import json
import logging
import re
import time
from datetime import datetime, timezone
from uuid import UUID, uuid4

from flask import current_app, g, request

from .config import commerce_configured
from .database import db
from .errors import ApiError
from .validation import pagination

CATEGORIES = ("product", "inventory", "order", "account", "security", "system")
SERVER_ACTIONS = {
    "auth.login": ("account", "session"),
    "auth.logout": ("account", "session"),
    "auth.password_changed": ("security", "session"),
    "media.uploaded": ("product", "media"),
    "product.translated": ("product", "product"),
}
SUCCESS_ENDPOINTS = {
    "auth.login": "auth.login",
    "auth.logout": "auth.logout",
    "auth.update_password": "auth.password_changed",
    "media.upload_image": "media.uploaded",
    "media.translate_product": "product.translated",
}
LOG_COLUMNS = "id,created_at,category,action,severity,source,actor_id,entity_type,entity_id,details,request_id"
_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def _logger():
    logger = logging.getLogger("alyzyus.audit")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def structured(event, *, severity="info", **fields):
    """รับเฉพาะค่าที่โค้ดกำหนดเอง ห้ามส่ง request body หรือ exception message เข้ามา"""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "severity": severity,
        **fields,
    }
    level = {"info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}[severity]
    _logger().log(level, json.dumps(record, ensure_ascii=False, separators=(",", ":")))


def mark_error(code):
    g.audit_error_code = (
        code if isinstance(code, str) and _CODE.fullmatch(code) else "INTERNAL_ERROR"
    )


def _safe_uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def record_server_event(action):
    """เหตุการณ์สำเร็จเท่านั้น: actor มาจาก Auth ที่เซิร์ฟเวอร์ตรวจแล้ว ไม่เชื่อข้อมูลจากฟอร์ม"""
    if action not in SERVER_ACTIONS:
        raise ValueError("Unsupported audit action")
    actor = _safe_uuid((getattr(g, "auth_user", None) or {}).get("id"))
    if not actor:
        return
    request_id = _safe_uuid(getattr(g, "request_id", None))
    structured(action, actor_id=actor, request_id=request_id)
    # การทดสอบเดิมไม่ทำ outbound write โดยปริยาย; ชุด audit เปิดตรวจจริงด้วย MockTransport
    if not current_app.config.get(
        "AUDIT_PERSIST", not current_app.testing
    ) or not commerce_configured(current_app.config):
        return
    key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Accept": "application/json", "Cookie": ""}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    body = {"p_action": action, "p_actor_id": actor, "p_request_id": request_id}
    try:
        # ไม่สร้าง background thread และไม่ retry: ตั้ง network timeout งานเสริมไว้ 2 วินาที
        response = db().client.request(
            "POST",
            current_app.config["SUPABASE_URL"] + "/rest/v1/rpc/record_activity_event",
            headers=headers,
            json=body,
            timeout=2,
        )
        if response.is_error:
            structured(
                "audit.persist_failed",
                severity="warning",
                request_id=request_id,
                status=response.status_code,
            )
    except Exception as exc:
        # บันทึกเฉพาะชนิดข้อผิดพลาด ไม่ดึงข้อความ provider หรือ URL ที่อาจมี secret
        structured(
            "audit.persist_failed",
            severity="warning",
            request_id=request_id,
            error_type=type(exc).__name__[:64],
        )


def init_audit(app):
    @app.before_request
    def begin_request():
        # สร้าง ID เอง ไม่รับ X-Request-ID จากบุคคลภายนอกลง log
        g.request_id = str(uuid4())
        g.audit_started = time.perf_counter()

    @app.after_request
    def finish_request(response):
        request_id = getattr(g, "request_id", str(uuid4()))
        response.headers["X-Request-ID"] = request_id
        route = request.url_rule.rule if request.url_rule else "unmatched"
        action = SUCCESS_ENDPOINTS.get(request.endpoint)
        if action and 200 <= response.status_code < 300:
            record_server_event(action)
        # ไฟล์ static และ health check ปกติไม่ต้องสร้าง log ถี่ ๆ
        if (
            request.endpoint == "static" or request.endpoint == "api.health"
        ) and response.status_code < 400:
            return response
        severity = (
            "error"
            if response.status_code >= 500
            else "warning"
            if response.status_code >= 400
            else "info"
        )
        fields = {
            "request_id": request_id,
            "method": request.method
            if request.method in ("GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS")
            else "OTHER",
            "route": route,
            "status": response.status_code,
            "duration_ms": max(
                0,
                round(
                    (time.perf_counter() - getattr(g, "audit_started", time.perf_counter())) * 1000
                ),
            ),
        }
        if getattr(g, "audit_error_code", None):
            fields["error_code"] = g.audit_error_code
        structured("http.request", severity=severity, **fields)
        return response

    structured(
        "app.started",
        environment="production"
        if app.config.get("SITE_URL", "").startswith("https://")
        else "local",
    )


def read_logs():
    """ใช้ keyset pagination ป้องกัน offset ที่ไกลมากและไม่เปิด arbitrary SQL filters"""
    limit, cursor = pagination(50, filters=("category",))
    category = request.args.get("category", "all")
    if category != "all" and category not in CATEGORIES:
        raise ApiError("INVALID_INPUT", 400)
    params = {"select": LOG_COLUMNS, "order": "id.desc", "limit": str(limit + 1)}
    if cursor is not None:
        params["id"] = "lt." + cursor
    if category != "all":
        params["category"] = "eq." + category
    # ใช้ JWT ของผู้ดูแลเพื่อให้ RLS ตรวจซ้ำ แทนการ bypass ด้วย service role
    rows, _ = db().select("activity_logs", token=g.access_token, params=params)
    rows = rows or []
    more = len(rows) > limit
    result = [{**row, "id": str(row["id"])} for row in rows[:limit]]
    return {
        "logs": result,
        "nextCursor": result[-1]["id"] if more and result else None,
        "hasMore": more,
        "limit": limit,
        "categories": list(CATEGORIES),
    }
