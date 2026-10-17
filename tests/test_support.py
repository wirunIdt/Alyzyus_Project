"""ตรวจเส้นทาง Support, ตัวตนจริง, ขอบเขตข้อมูล และ safe error mapping"""

import base64
import json
import unittest

import httpx

from server import create_app
from server.auth import ACCESS

ORIGIN = "http://localhost"
USER = "61111111-1111-4111-8111-111111111111"
OTHER = "62222222-2222-4222-8222-222222222222"
KEY = "63333333-3333-4333-8333-333333333333"
BIG_ID = 9007199254740993
UPDATED_AT = "2026-10-17T10:20:30.123456+00:00"


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.role = "customer"
        self.confirmed = True
        self.failure = None
        self.ticket_rows = None
        self.transport = httpx.Client(transport=httpx.MockTransport(self.provider))
        self.app = create_app(
            {
                "TESTING": True,
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test",
                "APP_SECRET_KEY": "a" * 48,
                "SITE_URL": ORIGIN,
                "HTTP_CLIENT": self.transport,
            }
        )
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def provider(self, request):
        self.calls.append(request)
        path = request.url.path
        if path == "/auth/v1/user":
            # metadata role ที่ผู้ใช้แก้เองต้องไม่ทำให้ผ่าน require_admin
            return httpx.Response(
                200,
                json={
                    "id": USER,
                    "email_confirmed_at": "2026-10-15T00:00:00Z" if self.confirmed else None,
                    "is_anonymous": False,
                    "user_metadata": {"role": "admin"},
                },
            )
        if path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"role": self.role}])
        if path == "/rest/v1/support_tickets":
            if request.url.params.get("id") == "eq.99":
                return httpx.Response(200, json=[])
            return httpx.Response(
                200,
                json=self.ticket_rows
                if self.ticket_rows is not None
                else [
                    {
                        "id": BIG_ID,
                        "ticket_number": "ALY-S-" + str(BIG_ID),
                        "user_id": USER,
                        "subject": "Product question",
                        "status": "open",
                        "category": "product",
                        "updated_at": UPDATED_AT,
                    }
                ],
            )
        if path == "/rest/v1/support_messages":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": BIG_ID + 1,
                        "ticket_id": BIG_ID,
                        "author_role": "customer",
                        "body": "Private question content",
                    }
                ],
            )
        if path.startswith("/rest/v1/rpc/"):
            if self.failure:
                return httpx.Response(
                    400, json={"message": self.failure, "details": "provider private detail"}
                )
            return httpx.Response(
                200, json=str(BIG_ID + 1 if path.endswith("reply_support_ticket") else BIG_ID)
            )
        return httpx.Response(404)

    def sign_in(self):
        self.client.set_cookie(ACCESS, "verified-session")

    def payload(self):
        return {
            "category": "product",
            "subject": "Product question",
            "message": "How can I use this product?",
            "orderId": None,
            "idempotencyKey": KEY,
        }

    def post(self, path, body):
        return self.client.post(path, json=body, headers={"Origin": ORIGIN})

    def test_all_routes_require_verified_identity(self):
        for path in (
            "/api/support/tickets",
            "/api/support/tickets/1",
            "/api/admin/support/tickets",
        ):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.post("/api/support/tickets", self.payload()).status_code, 401)
        self.sign_in()
        self.confirmed = False
        self.assertEqual(self.client.get("/api/support/tickets").status_code, 403)
        self.assertFalse(any("/support_" in str(call.url) for call in self.calls))

    def test_browser_role_claim_cannot_read_or_reply_as_staff(self):
        self.sign_in()
        self.assertEqual(self.client.get("/api/admin/support/tickets").status_code, 403)
        self.assertEqual(
            self.post(
                "/api/admin/support/tickets/1/messages",
                {"message": "A helpful staff response", "idempotencyKey": KEY},
            ).status_code,
            403,
        )
        self.assertFalse(any("/rpc/" in str(call.url) for call in self.calls))

    def test_customer_list_and_detail_read_with_jwt_and_owner_filter(self):
        self.sign_in()
        result = self.client.get("/api/support/tickets?status=open&limit=10")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["tickets"][0]["id"], str(BIG_ID))
        call = next(call for call in self.calls if call.url.path.endswith("support_tickets"))
        self.assertEqual(call.url.params["user_id"], "eq." + USER)
        self.assertEqual(call.url.params["order"], "updated_at.desc,id.desc")
        self.assertEqual(call.url.params["status"], "eq.open")
        self.assertEqual(call.headers["Authorization"], "Bearer verified-session")
        self.assertEqual(call.headers["apikey"], "sb_publishable_test")
        result = self.client.get("/api/support/tickets/" + str(BIG_ID))
        self.assertEqual(result.json["messages"][0]["ticket_id"], str(BIG_ID))
        self.assertEqual(result.json["messages"][0]["id"], str(BIG_ID + 1))
        self.assertIn("no-store", result.headers["Cache-Control"])

    def test_not_found_detail_does_not_fetch_messages(self):
        self.sign_in()
        self.assertEqual(self.client.get("/api/support/tickets/99").status_code, 404)
        self.assertFalse(any(call.url.path.endswith("support_messages") for call in self.calls))

    def test_query_injection_duplicates_and_unsafe_ids_rejected(self):
        self.sign_in()
        paths = (
            "?limit=101",
            "?limit=0",
            "?cursor=1)&or=(id.gt.0",
            "?status=open&status=closed",
            "?offset=50",
            "?status=unknown",
            "?cursor=9223372036854775808",
            "?cursor=45",
            "?category=order&category=payment",
            "?category=not-valid",
            "?q=ALY-S-1)&or=(id.gt.0",
            "?q=0",
            "?q=ALY-S-9223372036854775808",
            "/not-an-id",
            "/0",
        )
        for suffix in paths:
            self.assertEqual(
                self.client.get("/api/support/tickets" + suffix).status_code, 400, suffix
            )
        self.assertFalse(any(call.url.path.endswith("support_tickets") for call in self.calls))

    def test_create_uses_server_actor_and_service_key_but_returns_only_read_columns(self):
        self.sign_in()
        result = self.post("/api/support/tickets", self.payload())
        self.assertEqual(result.status_code, 201)
        call = next(call for call in self.calls if call.url.path.endswith("create_support_ticket"))
        body = json.loads(call.content)
        self.assertEqual(body["p_actor_id"], USER)
        self.assertEqual(body["p_idempotency_key"], KEY)
        self.assertEqual(len(body["p_fingerprint"]), 64)
        self.assertEqual(call.headers["apikey"], "sb_secret_test")
        self.assertNotIn("Authorization", call.headers)
        read = next(call for call in self.calls if call.url.path.endswith("support_tickets"))
        self.assertNotIn("request_fingerprint", read.url.params["select"])

    def test_invalid_content_and_browser_identity_override_never_reach_rpc(self):
        self.sign_in()
        cases = [
            {**self.payload(), "user_id": OTHER},
            {**self.payload(), "status": "closed"},
            {**self.payload(), "category": "vip"},
            {**self.payload(), "message": "short"},
            {**self.payload(), "subject": "line\nbreak"},
            {**self.payload(), "orderId": "not-uuid"},
        ]
        for body in cases:
            self.assertEqual(self.post("/api/support/tickets", body).status_code, 400)
        self.assertFalse(any("/rpc/" in str(call.url) for call in self.calls))

    def test_mutations_preserve_origin_and_json_guards(self):
        self.sign_in()
        self.assertEqual(
            self.client.post("/api/support/tickets", json=self.payload()).status_code, 403
        )
        self.assertEqual(
            self.client.post(
                "/api/support/tickets",
                json=self.payload(),
                headers={"Origin": "https://other.example"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/support/tickets", data="hello", headers={"Origin": ORIGIN}
            ).status_code,
            415,
        )

    def test_staff_flag_comes_from_verified_admin_route_only(self):
        self.sign_in()
        body = {"message": "This is a customer response", "idempotencyKey": KEY}
        self.assertEqual(self.post("/api/support/tickets/1/messages", body).status_code, 201)
        call = next(call for call in self.calls if call.url.path.endswith("reply_support_ticket"))
        self.assertFalse(json.loads(call.content)["p_as_staff"])
        self.role = "admin"
        self.calls.clear()
        self.assertEqual(self.post("/api/admin/support/tickets/1/messages", body).status_code, 201)
        call = next(call for call in self.calls if call.url.path.endswith("reply_support_ticket"))
        self.assertTrue(json.loads(call.content)["p_as_staff"])

    def test_business_errors_are_safe_and_status_is_derived_from_action(self):
        self.sign_in()
        for code, status in (
            ("SUPPORT_RATE_LIMITED", 429),
            ("SUPPORT_CLOSED", 409),
            ("IDEMPOTENCY_CONFLICT", 409),
            ("SUPPORT_STALE", 409),
        ):
            self.failure = code
            result = self.post("/api/support/tickets", self.payload())
            self.assertEqual(result.status_code, status)
            self.assertEqual(result.json["error"]["code"], code)
            self.assertNotIn("provider private detail", result.get_data(as_text=True))
        self.failure = None
        self.assertEqual(
            self.client.patch(
                "/api/support/tickets/1",
                json={"action": "close", "expectedUpdatedAt": UPDATED_AT},
                headers={"Origin": ORIGIN},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.patch(
                "/api/support/tickets/1",
                json={"action": "resolve", "expectedUpdatedAt": UPDATED_AT},
                headers={"Origin": ORIGIN},
            ).status_code,
            200,
        )

    def test_activity_cursor_preserves_microseconds_and_bigint_tie_breaker(self):
        self.sign_in()
        self.ticket_rows = [
            {"id": BIG_ID, "updated_at": UPDATED_AT},
            {"id": BIG_ID - 1, "updated_at": UPDATED_AT},
        ]
        result = self.client.get("/api/support/tickets?limit=1")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["tickets"][0]["id"], str(BIG_ID))
        cursor = result.json["nextCursor"]
        self.assertTrue(result.json["hasMore"])
        self.assertNotEqual(cursor, str(BIG_ID))
        self.calls.clear()
        result = self.client.get("/api/support/tickets", query_string={"cursor": cursor})
        self.assertEqual(result.status_code, 200)
        call = next(call for call in self.calls if call.url.path.endswith("support_tickets"))
        self.assertEqual(
            call.url.params["or"],
            f"(updated_at.lt.{UPDATED_AT},and(updated_at.eq.{UPDATED_AT},id.lt.{BIG_ID}))",
        )
        self.assertEqual(call.url.params["order"], "updated_at.desc,id.desc")

    def test_ticket_filters_use_exact_number_and_enum_without_arbitrary_search(self):
        self.sign_in()
        for query in (str(BIG_ID), "ALY-S-" + str(BIG_ID), "aly-s-" + str(BIG_ID)):
            self.calls.clear()
            result = self.client.get(
                "/api/support/tickets",
                query_string={"q": query, "category": "payment", "status": "pending"},
            )
            self.assertEqual(result.status_code, 200)
            call = next(call for call in self.calls if call.url.path.endswith("support_tickets"))
            self.assertEqual(call.url.params["id"], "eq." + str(BIG_ID))
            self.assertEqual(call.url.params["category"], "eq.payment")
            self.assertEqual(call.url.params["status"], "eq.pending")
            self.assertEqual(call.url.params["user_id"], "eq." + USER)
            self.assertFalse(any("ilike" in value for value in call.url.params.values()))

    def test_invalid_activity_cursors_never_reach_support_table(self):
        self.sign_in()
        values = [
            "not-json",
            "x" * 241,
            {"v": 1, "at": "2026-10-17T10:20:30Z),id.gt.0", "id": "1"},
            {"v": 1, "at": "2026-10-17T10:20:30Z", "id": "9223372036854775808"},
            {"v": True, "at": "2026-10-17T10:20:30Z", "id": "1"},
            {"v": 1, "at": "2026-10-17T10:20:30Z", "id": "1", "extra": 1},
        ]
        for value in values:
            cursor = value
            if isinstance(value, dict):
                cursor = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
            result = self.client.get("/api/support/tickets", query_string={"cursor": cursor})
            self.assertEqual(result.status_code, 400)
        self.assertFalse(any(call.url.path.endswith("support_tickets") for call in self.calls))

    def test_status_action_requires_a_valid_revision_and_uses_guarded_rpc(self):
        self.sign_in()
        for body in (
            {"action": "resolve"},
            {"action": "resolve", "expectedUpdatedAt": "yesterday"},
            {"action": "resolve", "expectedUpdatedAt": "2026-02-30T10:00:00Z"},
            {"action": "resolve", "expectedUpdatedAt": "2026-10-17T10:00:00"},
        ):
            response = self.client.patch(
                "/api/support/tickets/1", json=body, headers={"Origin": ORIGIN}
            )
            self.assertEqual(response.status_code, 400)
        self.assertFalse(any("/rpc/" in str(call.url) for call in self.calls))
        response = self.client.patch(
            "/api/support/tickets/1",
            json={"action": "resolve", "expectedUpdatedAt": "2026-10-17T17:20:30.123456+07:00"},
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 200)
        call = next(
            call for call in self.calls if call.url.path.endswith("change_support_ticket_revision")
        )
        self.assertEqual(json.loads(call.content)["p_expected_updated_at"], UPDATED_AT)
        self.assertFalse(json.loads(call.content)["p_as_staff"])


if __name__ == "__main__":
    unittest.main()
