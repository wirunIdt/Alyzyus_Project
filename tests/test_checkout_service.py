"""Use-case tests run without a Flask app/request, network, credentials or database."""

import copy
import unittest
from unittest.mock import Mock

from server.errors import ApiError
from server.repositories.orders import OrderRepository
from server.services.checkout import create_checkout_order


class CheckoutServiceTests(unittest.TestCase):
    def setUp(self):
        self.value = {
            "items": [
                {"productId": "product-b", "quantity": 2},
                {"productId": "product-a", "quantity": 1},
            ],
            "customer": {"name": "Fixture Customer"},
            "paymentMethod": "cod",
            "coupon": "",
            "idempotencyKey": "same-request-key",
        }
        self.user = {"id": "verified-owner"}
        self.order = {
            "id": "stored-order",
            "order_number": "ALY-FIXTURE",
            "status": "pending",
            "payment_status": "pending",
            "total": 777,
        }
        self.record = {**self.order, "stripe_session_id": "private-fixture-session"}
        self.repository = Mock()
        self.repository.create.return_value = self.order["id"]
        self.repository.for_owner.return_value = self.record
        self.mapper = Mock(return_value=self.order)
        self.hosted = Mock(return_value={"order": self.order, "checkoutUrl": "fixture"})
        self.payment = {"bankDetails": {"bank": "Fixture Bank", "accountNumber": "example"}}

    def run_service(self, value=None):
        return create_checkout_order(
            value or self.value,
            self.user,
            self.payment,
            repository=self.repository,
            hosted_checkout=self.hosted,
            order_mapper=self.mapper,
        )

    def test_cod_reads_saved_server_order_for_verified_owner(self):
        response = self.run_service()
        self.assertEqual(response, {"order": self.order})
        self.repository.for_owner.assert_called_once_with("stored-order", "verified-owner")
        self.mapper.assert_called_once_with(self.record)
        self.hosted.assert_not_called()

    def test_reordered_cart_uses_same_fingerprint_but_changed_quantity_does_not(self):
        original = copy.deepcopy(self.value)
        self.run_service()
        first = self.repository.create.call_args.args[2]
        reordered = {**self.value, "items": list(reversed(self.value["items"]))}
        self.run_service(reordered)
        self.assertEqual(first, self.repository.create.call_args.args[2])
        changed = copy.deepcopy(self.value)
        changed["items"][0]["quantity"] += 1
        self.run_service(changed)
        self.assertNotEqual(first, self.repository.create.call_args.args[2])
        self.assertEqual(self.value, original)

    def test_bank_instructions_use_saved_amount_and_reference(self):
        self.value["paymentMethod"] = "bank_transfer"
        response = self.run_service()
        self.assertEqual(response["paymentInstructions"]["amount"], 777)
        self.assertEqual(response["paymentInstructions"]["reference"], "ALY-FIXTURE")
        self.hosted.assert_not_called()

    def test_hosted_payment_is_called_only_after_order_commit_and_owner_read(self):
        self.value["paymentMethod"] = "card"
        response = self.run_service()
        self.assertEqual(response["checkoutUrl"], "fixture")
        self.hosted.assert_called_once_with(self.record, self.order, self.user)

    def test_paid_retry_does_not_open_another_payment_session(self):
        self.value["paymentMethod"] = "card"
        self.order["payment_status"] = "paid"
        self.assertEqual(self.run_service(), {"order": self.order})
        self.hosted.assert_not_called()

    def test_cancelled_order_does_not_open_payment(self):
        self.order["status"] = "cancelled"
        with self.assertRaises(ApiError) as result:
            self.run_service()
        self.assertEqual(result.exception.code, "ORDER_CANCELLED")
        self.hosted.assert_not_called()

    def test_database_failure_does_not_call_provider_or_make_an_owner_read(self):
        self.repository.create.side_effect = ApiError("OUT_OF_STOCK", 409)
        with self.assertRaises(ApiError):
            self.run_service()
        self.repository.for_owner.assert_not_called()
        self.hosted.assert_not_called()

    def test_repository_binds_privileged_order_read_to_order_and_owner(self):
        transport = Mock()
        transport.select.return_value = ([self.record], {})
        repository = OrderRepository(transport)
        self.assertEqual(repository.for_owner("stored-order", "verified-owner"), self.record)
        transport.select.assert_called_once_with(
            "orders",
            admin=True,
            params={
                "select": "*,order_items(*)",
                "id": "eq.stored-order",
                "user_id": "eq.verified-owner",
                "limit": "1",
            },
        )


if __name__ == "__main__":
    unittest.main()
