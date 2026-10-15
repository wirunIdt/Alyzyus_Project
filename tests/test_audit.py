"""ตรวจสิทธิ์ผู้ดูแล การแบ่งหน้า และการไม่รั่วข้อมูลลับใน log จริงของ Flask"""
import json
import unittest
from uuid import UUID

import httpx

from server import create_app
from server.auth import ACCESS

ORIGIN = "https://shop.example"
ACTOR = "11111111-1111-4111-8111-111111111111"
USER = {"id": ACTOR, "email": "private-buyer@example.com", "email_confirmed_at": "2026-10-15T00:00:00Z", "is_anonymous": False, "user_metadata": {"role": "admin", "name": "Private Person"}}
CONFIG = {"TESTING": True, "AUDIT_PERSIST": True, "SITE_URL": ORIGIN, "APP_SECRET_KEY": "a" * 48, "SUPABASE_URL": "https://project.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test", "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test"}


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.role = "customer"
        self.audit_failure = False
        self.login_failure = False
        self.requests = []
        self.persisted = []
        self.transport = httpx.Client(transport=httpx.MockTransport(self.provider))
        self.app = create_app({**CONFIG, "HTTP_CLIENT": self.transport})
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def provider(self, request):
        self.requests.append(request)
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json=USER)
        if request.url.path == "/auth/v1/token":
            if self.login_failure:
                return httpx.Response(400, json={"error_code": "invalid_credentials", "message": "private provider detail"})
            return httpx.Response(200, json={"user": USER, "access_token": "access-secret", "refresh_token": "refresh-secret"})
        if request.url.path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"role": self.role}])
        if request.url.path == "/rest/v1/activity_logs":
            rows = [{"id": str(number), "created_at": "2026-10-15T00:00:00Z", "category": "inventory", "action": "inventory.stock_changed", "severity": "info", "source": "database", "actor_id": ACTOR, "entity_type": "product", "entity_id": ACTOR, "details": {"before": {"stock": 4}, "after": {"stock": 3}}, "request_id": None} for number in (9007199254740994, 9007199254740993, 9007199254740992)]
            cursor = request.url.params.get("id")
            if cursor:
                rows = [row for row in rows if int(row["id"]) < int(cursor.removeprefix("lt."))]
            return httpx.Response(200, json=rows[:int(request.url.params["limit"])])
        if request.url.path == "/rest/v1/rpc/record_activity_event":
            self.persisted.append(json.loads(request.content))
            if self.audit_failure:
                return httpx.Response(503, json={"message": "private provider detail", "key": "must-never-log"})
            return httpx.Response(204)
        raise AssertionError("Unexpected provider path")

    def sign_in(self):
        self.client.set_cookie(ACCESS, "access-secret", domain="shop.example", secure=True)

    def get(self, path, **kwargs):
        return self.client.get(path, base_url=ORIGIN, **kwargs)

    def login(self, **kwargs):
        return self.client.post("/api/auth/login?private=secret-query", json={"email": USER["email"], "password": "private-password-123"}, base_url=ORIGIN, headers={"Origin": ORIGIN, "X-Request-ID": "caller-controlled-secret", "X-Forwarded-For": "192.0.2.21", **kwargs})

    def test_log_api_cannot_be_read_by_anonymous_or_customer(self):
        self.assertEqual(self.get("/api/admin/logs").status_code, 401)
        self.sign_in()
        self.assertEqual(self.get("/api/admin/logs").status_code, 403)
        self.assertFalse(any(request.url.path.endswith("activity_logs") for request in self.requests))

    def test_admin_uses_rls_token_and_bigint_safe_keyset_pagination(self):
        self.role = "admin"
        self.sign_in()
        response = self.get("/api/admin/logs?limit=2&category=inventory")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["nextCursor"], "9007199254740993")
        self.assertTrue(response.json["hasMore"])
        self.assertIsInstance(response.json["logs"][0]["id"], str)
        query = self.requests[-1]
        self.assertEqual(query.url.params["limit"], "3")
        self.assertEqual(query.url.params["category"], "eq.inventory")
        self.assertEqual(query.headers["apikey"], "sb_publishable_test")
        self.assertEqual(query.headers["Authorization"], "Bearer access-secret")
        more = self.get("/api/admin/logs?limit=2&cursor=" + response.json["nextCursor"])
        self.assertFalse(more.json["hasMore"])
        self.assertIsNone(more.json["nextCursor"])
        self.assertEqual(more.json["logs"][0]["id"], "9007199254740992")
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_invalid_filters_are_rejected_before_query(self):
        self.role = "admin"
        self.sign_in()
        for query in ("limit=0", "limit=101", "limit=1.1", "limit=" + "9" * 3000, "cursor=-1", "cursor=0", "cursor=9223372036854775808", "cursor=1)or(id.gt.0", "category=private", "order=actor_id", "limit=1&limit=2"):
            with self.subTest(query=query):
                self.assertEqual(self.get("/api/admin/logs?" + query).status_code, 400)
        self.assertFalse(any(request.url.path.endswith("activity_logs") for request in self.requests))

    def test_login_records_only_verified_actor_and_generated_request_id(self):
        with self.assertLogs("alyzyus.audit", level="INFO") as captured:
            response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.persisted), 1)
        payload = self.persisted[0]
        self.assertEqual(set(payload), {"p_action", "p_actor_id", "p_request_id"})
        self.assertEqual(payload["p_actor_id"], ACTOR)
        self.assertEqual(payload["p_action"], "auth.login")
        self.assertEqual(str(UUID(response.headers["X-Request-ID"])), payload["p_request_id"])
        self.assertEqual(self.requests[-1].extensions["timeout"]["read"], 2)
        output = " ".join(captured.output)
        for private in ("private-password", USER["email"], "access-secret", "refresh-secret", "sb_secret", "secret-query", "caller-controlled-secret", "192.0.2.21"):
            self.assertNotIn(private, output)

    def test_audit_outage_does_not_break_login_or_log_provider_body(self):
        self.audit_failure = True
        with self.assertLogs("alyzyus.audit", level="INFO") as captured:
            response = self.login()
        self.assertEqual(response.status_code, 200)
        output = " ".join(captured.output)
        self.assertIn("audit.persist_failed", output)
        self.assertNotIn("must-never-log", output)
        self.assertNotIn("private provider detail", output)

    def test_failed_login_only_emits_redacted_operational_log(self):
        self.login_failure = True
        with self.assertLogs("alyzyus.audit", level="INFO") as captured:
            response = self.login()
        self.assertEqual(response.status_code, 401)
        self.assertFalse(self.persisted)
        self.assertIn("INVALID_CREDENTIALS", " ".join(captured.output))
        self.assertNotIn(USER["email"], " ".join(captured.output))

    def test_routes_are_templates_and_unknown_path_and_query_are_not_recorded(self):
        @self.app.get("/audit-fault/<private_value>")
        def audit_fault(private_value):
            raise RuntimeError(private_value)

        with self.assertLogs("alyzyus.audit", level="INFO") as captured:
            self.assertEqual(self.get("/audit-fault/private-address?token_hash=secret-token").status_code, 500)
            self.assertEqual(self.get("/unknown-private-value?email=private-email").status_code, 404)
        output = " ".join(captured.output)
        self.assertIn("/audit-fault/<private_value>", output)
        self.assertIn("unmatched", output)
        for value in ("private-address", "secret-token", "unknown-private-value", "private-email"):
            self.assertNotIn(value, output)

    def test_successful_healthcheck_does_not_add_per_poll_log(self):
        with self.assertNoLogs("alyzyus.audit", level="INFO"):
            response = self.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn("X-Request-ID", response.headers)


if __name__ == "__main__":
    unittest.main()
