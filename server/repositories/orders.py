"""Checkout persistence adapter; privileged reads remain scoped to the verified owner."""

from ..database import map_order, single


class OrderRepository:
    def __init__(self, transport):
        self.transport = transport

    def create(self, user_id, value, fingerprint):
        """One PostgreSQL RPC owns price checks, stock locks and the atomic write."""
        return self.transport.rpc(
            "create_order",
            {
                "p_user_id": user_id,
                "p_items": value["items"],
                "p_customer": value["customer"],
                "p_payment_method": value["paymentMethod"],
                "p_coupon": value["coupon"] or None,
                "p_idempotency_key": value["idempotencyKey"],
                "p_request_fingerprint": fingerprint,
            },
        )

    def for_owner(self, order_id, user_id):
        rows, _ = self.transport.select(
            "orders",
            admin=True,
            params={
                "select": "*,order_items(*)",
                "id": "eq." + order_id,
                "user_id": "eq." + user_id,
                "limit": "1",
            },
        )
        return single(rows)

    @staticmethod
    def to_order(record):
        return map_order(record)
