"""Commerce routes keep privileged writes behind verified server authorization."""

import hashlib
import hmac
import json
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

from . import validation as v
from .audit import read_logs
from .auth import require_admin, require_user
from .config import commerce_configured
from .database import catalog, db, map_order, map_product, single
from .errors import ApiError
from .payments import EVENTS, close_before_cancellation, open_checkout, settings, verify_webhook

bp = Blueprint("api", __name__)


@bp.get("/api/products")
def products():
    return jsonify(catalog())


@bp.get("/api/settings")
def store_settings():
    return jsonify(settings())


@bp.get("/api/orders")
def orders():
    user = require_user()
    rows, _ = db().select(
        "orders",
        token=g.access_token,
        params={
            "select": "*,order_items(*)",
            "user_id": "eq." + user["id"],
            "order": "created_at.desc",
            "limit": "200",
        },
    )
    return jsonify(orders=[map_order(row) for row in rows or []])


@bp.post("/api/checkout")
def checkout():
    value = v.checkout(v.read_json())
    payment = settings()
    if not payment["configured"]:
        raise ApiError("STORE_NOT_CONFIGURED", 503)
    user = require_user()
    if not payment["payments"][value["paymentMethod"]]:
        raise ApiError("PAYMENT_UNAVAILABLE", 409)
    canonical = {
        "items": sorted(value["items"], key=lambda item: item["productId"]),
        "customer": value["customer"],
        "paymentMethod": value["paymentMethod"],
        "coupon": value["coupon"],
    }
    fingerprint = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    order_id = db().rpc(
        "create_order",
        {
            "p_user_id": user["id"],
            "p_items": value["items"],
            "p_customer": value["customer"],
            "p_payment_method": value["paymentMethod"],
            "p_coupon": value["coupon"] or None,
            "p_idempotency_key": value["idempotencyKey"],
            "p_request_fingerprint": fingerprint,
        },
    )
    rows, _ = db().select(
        "orders",
        admin=True,
        params={
            "select": "*,order_items(*)",
            "id": "eq." + order_id,
            "user_id": "eq." + user["id"],
            "limit": "1",
        },
    )
    row = single(rows)
    order = map_order(row)
    if order["status"] == "cancelled":
        raise ApiError("ORDER_CANCELLED", 409)
    if order["payment_status"] == "paid" or value["paymentMethod"] == "cod":
        return jsonify(order=order)
    if value["paymentMethod"] == "bank_transfer":
        return jsonify(
            order=order,
            paymentInstructions={
                "type": "bank_transfer",
                **payment["bankDetails"],
                "reference": order["order_number"],
                "amount": order["total"],
            },
        )
    return jsonify(open_checkout(row, order, user))


@bp.get("/api/admin")
def admin():
    if not commerce_configured(current_app.config):
        return jsonify(orders=[], products=[], configured=False, totalOrderCount=0, orderLimit=500)
    require_admin()
    rows, headers = db().select(
        "orders",
        token=g.access_token,
        params={"select": "*,order_items(*)", "order": "created_at.desc", "limit": "500"},
        count=True,
    )
    products, _ = db().select(
        "products", token=g.access_token, params={"select": "*", "order": "created_at.desc"}
    )
    total = headers.get("content-range", "").split("/")[-1]
    return jsonify(
        orders=[map_order(row) for row in rows or []],
        products=[map_product(row) for row in products or []],
        configured=True,
        totalOrderCount=int(total) if total.isdecimal() else len(rows or []),
        orderLimit=500,
    )


@bp.route("/api/admin/products", methods=["POST", "PATCH"])
def save_product():
    require_admin()
    partial = request.method == "PATCH"
    value = v.product(v.read_json(), partial=partial)
    product_id = value.pop("id", None)
    values = {key: item for key, item in value.items() if key != "compareAt"}
    if "compareAt" in value:
        values["compare_at"] = value["compareAt"]
    current = {}
    if partial:
        rows, _ = db().select(
            "products",
            token=g.access_token,
            params={"select": "price,compare_at", "id": "eq." + product_id, "limit": "1"},
        )
        current = single(rows, "PRODUCT_NOT_FOUND")
    price = value.get("price", current.get("price"))
    comparison = value.get("compareAt", current.get("compare_at"))
    if price is not None and comparison is not None and float(comparison) < float(price):
        raise ApiError("INVALID_PRICE", 400)
    values["updated_at"] = datetime.now(timezone.utc).isoformat()
    if not partial and product_id:
        values["id"] = product_id
    rows, _ = db().call(
        request.method,
        "/rest/v1/products",
        token=g.access_token,
        params={"id": "eq." + product_id} if partial else None,
        body=values,
        prefer="return=representation",
    )
    return jsonify(product=map_product(single(rows, "PRODUCT_NOT_FOUND"))), 200 if partial else 201


@bp.get("/api/admin/logs")
def activity_logs():
    require_admin()
    return jsonify(read_logs())


@bp.patch("/api/admin/orders")
def save_order():
    user = require_admin()
    if not commerce_configured(current_app.config):
        raise ApiError("STORE_NOT_CONFIGURED", 503)
    value = v.order_patch(v.read_json())
    if value.get("status") == "cancelled":
        rows, _ = db().select(
            "orders",
            admin=True,
            params={
                "select": "payment_method,payment_status,stripe_session_id,status",
                "id": "eq." + value["id"],
                "limit": "1",
            },
        )
        close_before_cancellation(single(rows))
    db().rpc(
        "update_order_admin",
        {
            "p_actor_id": user["id"],
            "p_order_id": value["id"],
            "p_status": value.get("status"),
            "p_tracking_number": value.get("tracking_number"),
            "p_carrier": value.get("carrier"),
            "p_payment_status": value.get("payment_status"),
        },
    )
    rows, _ = db().select(
        "orders",
        admin=True,
        params={"select": "*,order_items(*)", "id": "eq." + value["id"], "limit": "1"},
    )
    return jsonify(order=map_order(single(rows)))


@bp.post("/api/webhooks/stripe")
def stripe_webhook():
    event = verify_webhook(request.get_data(cache=False), request.headers.get("Stripe-Signature"))
    if event["type"] not in EVENTS:
        return jsonify(received=True)
    session = event["data"]["object"]
    if event["type"] == "checkout.session.completed" and session.get("payment_status") != "paid":
        return jsonify(received=True)
    if (
        event["type"] == "checkout.session.async_payment_succeeded"
        and session.get("payment_status") != "paid"
    ):
        raise ApiError("PAYMENT_MISMATCH", 400)
    metadata = session.get("metadata") or {}
    order_id, user_id = metadata.get("order_id"), metadata.get("user_id")
    if (
        not order_id
        or not user_id
        or session.get("client_reference_id") != order_id
        or session.get("currency") != "thb"
        or type(session.get("amount_total")) is not int
    ):
        raise ApiError("PAYMENT_MISMATCH", 400)
    order_id, user_id = v.uuid(order_id), v.uuid(user_id)
    rows, _ = db().select(
        "orders",
        admin=True,
        params={"select": "user_id,payment_method", "id": "eq." + order_id, "limit": "1"},
    )
    order = single(rows)
    if order["user_id"] != user_id or metadata.get("checkout_method") != order["payment_method"]:
        raise ApiError("PAYMENT_MISMATCH", 400)
    intent = session.get("payment_intent")
    db().rpc(
        "apply_stripe_event",
        {
            "p_event_id": event["id"],
            "p_event_type": event["type"],
            "p_order_id": order_id,
            "p_session_id": session["id"],
            "p_amount": session["amount_total"],
            "p_currency": session["currency"],
            "p_payment_intent": intent if isinstance(intent, str) else (intent or {}).get("id"),
        },
    )
    return jsonify(received=True)


@bp.get("/api/health")
def health():
    response = {"status": "ok", "store": "Alyzyus"}
    secret = current_app.config["HEALTHCHECK_SECRET"]
    bearer = request.headers.get("Authorization", "")
    if secret and hmac.compare_digest(bearer, "Bearer " + secret):
        response["configured"] = commerce_configured(current_app.config)
        response["payments"] = settings()["payments"]
        if response["configured"]:
            db().select("products", params={"select": "id", "limit": "1"})
            response["database"] = "reachable"
    return jsonify(response)
