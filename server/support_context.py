"""Read-only order context for a verified customer-service conversation."""

from flask import Blueprint, g, jsonify, request

from . import validation as v
from .auth import require_admin, require_user
from .database import db, single
from .errors import ApiError
from .support import _ticket

bp = Blueprint("support_context", __name__)
ORDER_FIELDS = (
    "id",
    "order_number",
    "status",
    "payment_status",
    "payment_method",
    "total",
    "created_at",
    "tracking_number",
    "carrier",
)


@bp.get("/api/support/tickets/<ticket_id>/order")
@bp.get("/api/admin/support/tickets/<ticket_id>/order")
def ticket_order(ticket_id):
    admin = request.path.startswith("/api/admin/")
    user = require_admin() if admin else require_user()
    ticket_id = v.bigint_id(ticket_id)
    if request.args:
        raise ApiError("INVALID_INPUT")
    # ตรวจสิทธิ์ของเรื่องก่อนอ่านออเดอร์ และใช้ JWT/RLS ทุกครั้ง แม้ในหน้า Admin
    ticket = _ticket(ticket_id, user, admin)
    if not ticket.get("order_id"):
        return jsonify(order=None)
    params = {
        "select": ",".join(ORDER_FIELDS),
        "id": "eq." + v.uuid(ticket["order_id"]),
        "limit": "1",
    }
    if not admin:
        params["user_id"] = "eq." + user["id"]
    rows, _ = db().select("orders", token=g.access_token, params=params)
    row = single(rows, "SUPPORT_NOT_FOUND")
    # หน้าบริการลูกค้าไม่ต้องรับชื่อ ที่อยู่ เบอร์โทร อีเมล หรือรายการสินค้าทั้งหมด
    order = {field: row.get(field) for field in ORDER_FIELDS}
    order["total"] = float(row["total"])
    order["currency"] = "THB"
    return jsonify(order=order)
