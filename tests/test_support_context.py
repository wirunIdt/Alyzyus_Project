"""Order handoff keeps ticket privacy, JWT/RLS and a minimal summary contract."""

import unittest

import httpx

from server import create_app
from server.auth import ACCESS
from server.support_context import ORDER_FIELDS

USER = "61111111-1111-4111-8111-111111111111"
OTHER = "62222222-2222-4222-8222-222222222222"
ORDER = "63333333-3333-4333-8333-333333333333"
TICKET = "9007199254740993"


class SupportOrderContextTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.role = "customer"
        self.confirmed = True
        self.ticket_owner = USER
        self.order_owner = USER
        self.order_id = ORDER
        self.order_available = True
        self.ticket_available = True
        self.transport = httpx.Client(transport=httpx.MockTransport(self.provider))
        self.app = create_app(
            {
                "TESTING": True,
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test",
                "APP_SECRET_KEY": "a" * 48,
                "SITE_URL": "http://localhost",
                "HTTP_CLIENT": self.transport,
                "AUDIT_PERSIST": False,
            }
        )
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def provider(self, request):
        self.calls.append(request)
        path = request.url.path
        params = request.url.params
        if path == "/auth/v1/user":
            return httpx.Response(
                200,
                json={
                    "id": USER,
                    "email_confirmed_at": "2026-10-17T00:00:00Z" if self.confirmed else None,
                    "is_anonymous": False,
                    "user_metadata": {"role": "admin"},
                },
            )
        if path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"role": self.role}])
        if path == "/rest/v1/support_tickets":
            visible = self.ticket_available and params["id"] == "eq." + TICKET
            if "user_id" in params:
                visible = visible and params["user_id"] == "eq." + self.ticket_owner
            return httpx.Response(
                200,
                json=[{"id": TICKET, "user_id": self.ticket_owner, "order_id": self.order_id}]
                if visible
                else [],
            )
        if path == "/rest/v1/orders":
            visible = self.order_available and params["id"] == "eq." + ORDER
            if "user_id" in params:
                visible = visible and params["user_id"] == "eq." + self.order_owner
            # Extra private columns deliberately test the response allowlist as a second boundary.
            return httpx.Response(
                200,
                json=[
                    {
                        "id": ORDER,
                        "order_number": "ALY-2026-1001",
                        "status": "shipped",
                        "payment_status": "paid",
                        "payment_method": "cod",
                        "total": "1199.50",
                        "created_at": "2026-10-17T01:00:00Z",
                        "tracking_number": "TRACK123",
                        "carrier": "Example carrier",
                        "customer_name": "Private person",
                        "email": "private@example.test",
                        "phone": "1234567890",
                        "address": "Private address",
                        "order_items": [{"name": "Private item"}],
                        "user_id": self.order_owner,
                    }
                ]
                if visible
                else [],
            )
        return httpx.Response(404)

    def sign_in(self):
        self.client.set_cookie(ACCESS, "verified-session")

    def get(self, admin=False, suffix=""):
        prefix = "/api/admin/support/tickets/" if admin else "/api/support/tickets/"
        return self.client.get(prefix + TICKET + "/order" + suffix)

    def data_calls(self, table):
        return [call for call in self.calls if call.url.path == "/rest/v1/" + table]

    def test_guest_and_unverified_accounts_cannot_read_order_context(self):
        for admin in (False, True):
            self.assertEqual(self.get(admin).status_code, 401)
        self.sign_in()
        self.confirmed = False
        for admin in (False, True):
            self.assertEqual(self.get(admin).status_code, 403)
        self.assertFalse(self.data_calls("orders"))
        self.assertFalse(self.data_calls("support_tickets"))

    def test_customer_cannot_claim_staff_access_with_editable_metadata(self):
        self.sign_in()
        self.assertEqual(self.get(admin=True).status_code, 403)
        self.assertFalse(self.data_calls("orders"))
        self.assertFalse(self.data_calls("support_tickets"))

    def test_customer_summary_uses_owner_filters_jwt_and_explicit_safe_columns(self):
        self.sign_in()
        response = self.get()
        self.assertEqual(response.status_code, 200)
        order = response.json["order"]
        self.assertEqual(set(order), {*ORDER_FIELDS, "currency"})
        self.assertEqual(order["total"], 1199.5)
        self.assertEqual(order["currency"], "THB")
        self.assertEqual(order["carrier"], "Example carrier")
        for table in ("support_tickets", "orders"):
            call = self.data_calls(table)[0]
            self.assertEqual(call.url.params["user_id"], "eq." + USER)
            self.assertEqual(call.headers["Authorization"], "Bearer verified-session")
            self.assertEqual(call.headers["apikey"], "sb_publishable_test")
        query = self.data_calls("orders")[0].url.params
        self.assertEqual(query["id"], "eq." + ORDER)
        self.assertEqual(set(query["select"].split(",")), set(ORDER_FIELDS))
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertNotIn("Private", response.get_data(as_text=True))
        self.assertNotIn("private@example", response.get_data(as_text=True))

    def test_ticket_without_order_does_not_query_orders(self):
        self.sign_in()
        self.order_id = None
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"order": None})
        self.assertFalse(self.data_calls("orders"))

    def test_foreign_or_missing_ticket_is_not_found_before_reading_orders(self):
        self.sign_in()
        for available, owner in ((True, OTHER), (False, USER)):
            self.ticket_available = available
            self.ticket_owner = owner
            self.assertEqual(self.get().status_code, 404)
        self.assertFalse(self.data_calls("orders"))

    def test_missing_or_foreign_order_remains_not_found_even_for_owned_ticket(self):
        self.sign_in()
        for available, owner in ((True, OTHER), (False, USER)):
            self.order_available = available
            self.order_owner = owner
            self.assertEqual(self.get().status_code, 404)

    def test_verified_admin_route_can_read_foreign_ticket_with_rls_and_minimal_payload(self):
        self.sign_in()
        self.role = "admin"
        self.ticket_owner = self.order_owner = OTHER
        response = self.get(admin=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json["order"]), {*ORDER_FIELDS, "currency"})
        for table in ("support_tickets", "orders"):
            call = self.data_calls(table)[0]
            self.assertNotIn("user_id", call.url.params)
            self.assertEqual(call.headers["Authorization"], "Bearer verified-session")
            self.assertEqual(call.headers["apikey"], "sb_publishable_test")
        # An Admin using the customer URL still has only the customer ownership scope.
        self.assertEqual(self.get(admin=False).status_code, 404)

    def test_invalid_id_and_query_identity_overrides_are_rejected_before_data_reads(self):
        self.sign_in()
        for ticket in ("0", "not-id", "9223372036854775808"):
            response = self.client.get("/api/support/tickets/" + ticket + "/order")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.get(suffix="?user_id=" + OTHER).status_code, 400)
        self.assertFalse(self.data_calls("support_tickets"))
        self.assertFalse(self.data_calls("orders"))


if __name__ == "__main__":
    unittest.main()
