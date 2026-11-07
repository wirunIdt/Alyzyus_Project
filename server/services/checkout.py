"""Checkout use case; receives dependencies instead of reading Flask request state."""

import hashlib
import json

from ..errors import ApiError


def create_checkout_order(value, user, payment, *, repository, hosted_checkout, order_mapper):
    """Accept validated input and a verified user supplied by the HTTP controller.

    PostgreSQL decides monetary amounts and commits order/items/stock together.
    The provider adapter runs only after that database transaction succeeds.
    """
    canonical = {
        "items": sorted(value["items"], key=lambda item: item["productId"]),
        "customer": value["customer"],
        "paymentMethod": value["paymentMethod"],
        "coupon": value["coupon"],
    }
    fingerprint = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    order_id = repository.create(user["id"], value, fingerprint)
    record = repository.for_owner(order_id, user["id"])
    order = order_mapper(record)
    if order["status"] == "cancelled":
        raise ApiError("ORDER_CANCELLED", 409)
    if order["payment_status"] == "paid" or value["paymentMethod"] == "cod":
        return {"order": order}
    if value["paymentMethod"] == "bank_transfer":
        return {
            "order": order,
            "paymentInstructions": {
                "type": "bank_transfer",
                **payment["bankDetails"],
                "reference": order["order_number"],
                "amount": order["total"],
            },
        }
    return hosted_checkout(record, order, user)
