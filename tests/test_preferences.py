"""Appearance permission must come from a confirmed, current server identity."""

import unittest

import httpx

from server import create_app
from server.auth import ACCESS

ORIGIN = "https://shop.example"
USER_ID = "11111111-1111-4111-8111-111111111111"


class AppearancePermissionTests(unittest.TestCase):
    def setUp(self):
        self.user = {
            "id": USER_ID,
            "email_confirmed_at": "2026-10-15T00:00:00Z",
            "is_anonymous": False,
        }
        self.available = True
        self.auth_calls = 0

        def provider(request):
            self.assertEqual(request.url.path, "/auth/v1/user")
            self.auth_calls += 1
            if not self.available:
                return httpx.Response(503, json={"message": "private provider diagnostic"})
            return httpx.Response(200, json=self.user)

        self.transport = httpx.Client(transport=httpx.MockTransport(provider))
        self.app = create_app(
            {
                "TESTING": True,
                "HTTP_CLIENT": self.transport,
                "AUDIT_PERSIST": False,
                "SITE_URL": ORIGIN,
                "APP_SECRET_KEY": "a" * 48,
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test",
            }
        )
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def get(self):
        return self.client.get("/api/account/appearance", base_url=ORIGIN)

    def sign_in(self):
        self.client.set_cookie(ACCESS, "server-session", domain="shop.example", secure=True)

    def test_guest_cannot_claim_permission_with_browser_identity(self):
        response = self.client.get(
            "/api/account/appearance?userId=" + USER_ID,
            base_url=ORIGIN,
            headers={"X-User-Id": USER_ID, "X-Member": "true"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("userId", response.json)
        self.assertEqual(self.auth_calls, 0)

    def test_confirmed_member_is_verified_on_every_request_without_role_requirement(self):
        self.sign_in()
        for _ in range(2):
            response = self.get()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json, {"allowed": True, "userId": USER_ID})
            self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        self.assertEqual(self.auth_calls, 2)

    def test_unconfirmed_and_anonymous_accounts_are_denied(self):
        self.sign_in()
        for fields in (
            {"email_confirmed_at": None, "is_anonymous": False},
            {"email_confirmed_at": "2026-10-15T00:00:00Z", "is_anonymous": True},
        ):
            self.user.update(fields)
            response = self.get()
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json["error"]["code"], "EMAIL_NOT_VERIFIED")
            self.assertNotIn("userId", response.json)

    def test_auth_provider_outage_never_grants_permission(self):
        self.sign_in()
        self.available = False
        response = self.get()
        self.assertGreaterEqual(response.status_code, 500)
        self.assertNotIn("userId", response.json)
        self.assertNotIn("private provider diagnostic", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
