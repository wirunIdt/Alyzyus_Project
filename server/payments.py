"""Hosted payments and verified provider callbacks."""
from datetime import datetime
from decimal import Decimal
from urllib.parse import urlencode

import stripe
from flask import current_app

from .config import commerce_configured, valid_origin
from .database import db
from .errors import ApiError

EVENTS = {"checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"}


def settings():
    config = current_app.config
    configured = commerce_configured(config)
    bank_ready = all(config[key] for key in ("BANK_NAME", "BANK_ACCOUNT_NAME", "BANK_ACCOUNT_NUMBER"))
    stripe_ready = bool(config["STRIPE_SECRET_KEY"] and config["STRIPE_WEBHOOK_SECRET"] and valid_origin(config["SITE_URL"]))
    result = {"configured": configured, "payments": {
        "cod": configured and config["PAYMENT_COD_ENABLED"],
        "bank_transfer": configured and bank_ready,
        "card": configured and stripe_ready and config["PAYMENT_CARD_ENABLED"],
        "promptpay": configured and stripe_ready and config["PAYMENT_PROMPTPAY_ENABLED"] and bool(config["STRIPE_PROMPTPAY_CONFIGURATION_ID"]),
    }}
    if configured and bank_ready:
        result["bankDetails"] = {"bank": config["BANK_NAME"], "accountName": config["BANK_ACCOUNT_NAME"], "accountNumber": config["BANK_ACCOUNT_NUMBER"]}
    return result


def client():
    key = current_app.config["STRIPE_SECRET_KEY"]
    if not key:
        raise ApiError("PAYMENT_UNAVAILABLE", 503)
    return stripe.StripeClient(key, max_network_retries=2, http_client=stripe.RequestsClient(timeout=20))


def open_checkout(row, order, user):
    origin = valid_origin(current_app.config["SITE_URL"])
    if not origin:
        raise ApiError("STORE_NOT_CONFIGURED", 503)
    method = order["payment_method"]
    configuration = current_app.config["STRIPE_PROMPTPAY_CONFIGURATION_ID"] if method == "promptpay" else current_app.config["STRIPE_CARD_CONFIGURATION_ID"]
    metadata = {"order_id": order["id"], "user_id": user["id"], "checkout_method": method}
    params = {
        "mode": "payment", "customer_email": order["email"], "client_reference_id": order["id"],
        "metadata": metadata, "payment_intent_data": {"metadata": metadata},
        "line_items": [{"price_data": {"currency": "thb", "unit_amount": int(Decimal(str(order["total"])) * 100), "product_data": {"name": "Alyzyus · " + order["order_number"], "description": f"{len(order['items'])} item(s) · shipping and discount included"}}, "quantity": 1}],
        "success_url": origin + "/tracking?" + urlencode({"order": order["order_number"], "payment": "processing"}),
        "cancel_url": origin + "/tracking?" + urlencode({"order": order["order_number"], "payment": "cancelled"}),
        "expires_at": int(datetime.fromisoformat(order["created_at"].replace("Z", "+00:00")).timestamp()) + 31 * 60,
    }
    if configuration:
        params["payment_method_configuration"] = configuration
    try:
        sessions = client().v1.checkout.sessions
        session = sessions.retrieve(row["stripe_session_id"]) if row.get("stripe_session_id") else sessions.create(params, options={"idempotency_key": "alyzyus-checkout-" + order["id"]})
    except stripe.StripeError as exc:
        # A timeout may follow successful creation. Preserve the order and retry its stable key.
        current_app.logger.warning("Hosted checkout failed (%s)", type(exc).__name__)
        raise ApiError("PAYMENT_PROVIDER_ERROR", 502) from exc
    db().call("PATCH", "/rest/v1/orders", admin=True, params={"id": "eq." + order["id"], "stripe_session_id": "is.null"}, body={"stripe_session_id": session.id})
    if session.status == "expired":
        raise ApiError("PAYMENT_EXPIRED", 409)
    result = {"order": order}
    if session.url:
        result["checkoutUrl"] = session.url
    return result


def close_before_cancellation(row):
    if row["payment_status"] == "paid":
        raise ApiError("REFUND_REQUIRED", 409)
    if row["payment_method"] not in ("card", "promptpay") or row["status"] == "cancelled":
        return
    if not row.get("stripe_session_id"):
        raise ApiError("PAYMENT_RECONCILIATION_REQUIRED", 409)
    try:
        sessions = client().v1.checkout.sessions
        session = sessions.retrieve(row["stripe_session_id"])
        if session.payment_status == "paid" or session.status == "complete":
            raise ApiError("REFUND_REQUIRED", 409)
        if session.status == "open":
            sessions.expire(session.id)
    except stripe.StripeError as exc:
        raise ApiError("PAYMENT_PROVIDER_ERROR", 502) from exc


def verify_webhook(body, signature):
    secret = current_app.config["STRIPE_WEBHOOK_SECRET"]
    if not secret:
        raise ApiError("PAYMENT_UNAVAILABLE", 503)
    if not signature:
        raise ApiError("INVALID_SIGNATURE", 400)
    try:
        return stripe.Webhook.construct_event(body, signature, secret, tolerance=300).to_dict()
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise ApiError("INVALID_SIGNATURE", 400) from exc
