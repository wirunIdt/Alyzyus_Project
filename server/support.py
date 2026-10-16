"""ศูนย์บริการลูกค้า: อ่านด้วย JWT/RLS และเขียนผ่าน transaction ฝั่งเซิร์ฟเวอร์เท่านั้น"""

import hashlib
import json

from flask import Blueprint, g, jsonify, request

from . import validation as v
from .auth import require_admin, require_user
from .database import db, single
from .errors import ApiError

bp = Blueprint("support", __name__)
CATEGORIES = ("order", "payment", "return", "product", "account", "other")
STATUSES = ("open", "pending", "resolved", "closed")
TICKET_COLUMNS = "id,ticket_number,user_id,order_id,category,subject,status,created_at,updated_at,last_message_at"
MESSAGE_COLUMNS = "id,ticket_id,author_role,body,created_at"
SUBJECT_MIN_LENGTH = 5
SUBJECT_MAX_LENGTH = 120
MESSAGE_MIN_LENGTH = 10
MESSAGE_MAX_LENGTH = 4000


def _text(value, minimum, maximum, multiline=False):
    value = v.string(value, minimum, maximum)
    if any(
        (ord(char) < 32 and (not multiline or char not in "\n\r\t")) or ord(char) == 127
        for char in value
    ):
        raise ApiError("INVALID_INPUT")
    return value


def _page(default_limit=20, *, include_status=False):
    limit, cursor = v.pagination(default_limit, filters=("status",) if include_status else ())
    selected = request.args.get("status", "all")
    if include_status and selected not in ("all", *STATUSES):
        raise ApiError("INVALID_INPUT")
    return limit, cursor, selected


def _mapped(row):
    result = dict(row)
    # bigint ต้องไม่ถูกแปลงผ่าน JavaScript Number ซึ่งเสียความแม่นยำหลัง 2^53
    for key in ("id", "ticket_id"):
        if key in result:
            result[key] = str(result[key])
    return result


def _paged(rows, limit, key):
    rows = rows or []
    more = len(rows) > limit
    result = [_mapped(row) for row in rows[:limit]]
    return {
        key: result,
        "nextCursor": result[-1]["id"] if more and result else None,
        "hasMore": more,
        "limit": limit,
    }


def _ticket(ticket_id, user, admin=False):
    params = {"select": TICKET_COLUMNS, "id": "eq." + ticket_id, "limit": "1"}
    if not admin:
        params["user_id"] = "eq." + user["id"]
    rows, _ = db().select("support_tickets", token=g.access_token, params=params)
    return _mapped(single(rows, "SUPPORT_NOT_FOUND"))


@bp.get("/api/support/tickets")
@bp.get("/api/admin/support/tickets")
def tickets():
    admin = request.path.startswith("/api/admin/")
    user = require_admin() if admin else require_user()
    limit, cursor, status = _page(include_status=True)
    params = {"select": TICKET_COLUMNS, "order": "id.desc", "limit": str(limit + 1)}
    if not admin:
        params["user_id"] = "eq." + user["id"]
    if cursor:
        params["id"] = "lt." + cursor
    if status != "all":
        params["status"] = "eq." + status
    rows, _ = db().select("support_tickets", token=g.access_token, params=params)
    return jsonify(_paged(rows, limit, "tickets"))


@bp.post("/api/support/tickets")
def create_ticket():
    user = require_user()
    raw = v.object_fields(
        v.read_json(),
        {"category", "subject", "message", "orderId", "idempotencyKey"},
        {"category", "subject", "message", "idempotencyKey"},
    )
    category = v.string(raw["category"], 1, 20)
    if category not in CATEGORIES:
        raise ApiError("INVALID_INPUT")
    value = {
        "category": category,
        "subject": _text(raw["subject"], SUBJECT_MIN_LENGTH, SUBJECT_MAX_LENGTH),
        "message": _text(raw["message"], MESSAGE_MIN_LENGTH, MESSAGE_MAX_LENGTH, multiline=True),
        "orderId": v.uuid(raw["orderId"]) if raw.get("orderId") is not None else None,
    }
    fingerprint = hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    ticket_id = db().rpc(
        "create_support_ticket",
        {
            "p_actor_id": user["id"],
            "p_category": category,
            "p_subject": value["subject"],
            "p_body": value["message"],
            "p_order_id": value["orderId"],
            "p_idempotency_key": v.uuid(raw["idempotencyKey"]),
            "p_fingerprint": fingerprint,
        },
    )
    return jsonify(ticket=_ticket(v.bigint_id(str(ticket_id)), user)), 201


@bp.get("/api/support/tickets/<ticket_id>")
@bp.get("/api/admin/support/tickets/<ticket_id>")
def ticket_detail(ticket_id):
    admin = request.path.startswith("/api/admin/")
    user = require_admin() if admin else require_user()
    ticket_id = v.bigint_id(ticket_id)
    limit, cursor, _ = _page(default_limit=40)
    ticket = _ticket(ticket_id, user, admin)
    params = {
        "select": MESSAGE_COLUMNS,
        "ticket_id": "eq." + ticket_id,
        "order": "id.desc",
        "limit": str(limit + 1),
    }
    if cursor:
        params["id"] = "lt." + cursor
    rows, _ = db().select("support_messages", token=g.access_token, params=params)
    return jsonify(ticket=ticket, **_paged(rows, limit, "messages"))


@bp.post("/api/support/tickets/<ticket_id>/messages")
@bp.post("/api/admin/support/tickets/<ticket_id>/messages")
def reply(ticket_id):
    admin = request.path.startswith("/api/admin/")
    user = require_admin() if admin else require_user()
    ticket_id = v.bigint_id(ticket_id)
    raw = v.object_fields(
        v.read_json(), {"message", "idempotencyKey"}, {"message", "idempotencyKey"}
    )
    body = _text(raw["message"], MESSAGE_MIN_LENGTH, MESSAGE_MAX_LENGTH, multiline=True)
    # อ่านผ่าน RLS ก่อนเขียนเพื่อให้เส้นทางลูกค้าไม่ยกระดับ Admin โดยเผลอ
    _ticket(ticket_id, user, admin)
    message_id = db().rpc(
        "reply_support_ticket",
        {
            "p_actor_id": user["id"],
            "p_ticket_id": ticket_id,
            "p_body": body,
            "p_as_staff": admin,
            "p_idempotency_key": v.uuid(raw["idempotencyKey"]),
            "p_fingerprint": hashlib.sha256(body.encode()).hexdigest(),
        },
    )
    rows, _ = db().select(
        "support_messages",
        token=g.access_token,
        params={
            "select": MESSAGE_COLUMNS,
            "ticket_id": "eq." + ticket_id,
            "id": "eq." + v.bigint_id(str(message_id)),
            "limit": "1",
        },
    )
    return jsonify(
        ticket=_ticket(ticket_id, user, admin), message=_mapped(single(rows, "SUPPORT_NOT_FOUND"))
    ), 201


@bp.patch("/api/support/tickets/<ticket_id>")
@bp.patch("/api/admin/support/tickets/<ticket_id>")
def ticket_action(ticket_id):
    admin = request.path.startswith("/api/admin/")
    user = require_admin() if admin else require_user()
    ticket_id = v.bigint_id(ticket_id)
    raw = v.object_fields(v.read_json(), {"action"}, {"action"})
    action = v.string(raw["action"], 1, 10)
    if action not in (("resolve", "reopen", "close") if admin else ("resolve", "reopen")):
        raise ApiError("INVALID_INPUT")
    _ticket(ticket_id, user, admin)
    db().rpc(
        "change_support_ticket",
        {
            "p_actor_id": user["id"],
            "p_ticket_id": ticket_id,
            "p_action": action,
            "p_as_staff": admin,
        },
    )
    return jsonify(ticket=_ticket(ticket_id, user, admin))
