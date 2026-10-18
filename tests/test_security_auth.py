"""Regressions for callback login CSRF and ambiguous URL validation.

MockTransport represents the trusted Auth service; no real email, key, or user
record is contacted. Tests assert that a valid attacker-owned credential alone
cannot place its session into another browser.
"""

import json
import time
import unittest
from unittest.mock import patch

import httpx

from server import create_app
from server.auth import ACCESS, FLOW_MAX_AGE, REFRESH, VERIFIER, serializer
from server.config import valid_origin
from server.errors import ApiError
from server.validation import product

ORIGIN = "https://shop.example"
EMAIL = "buyer@example.com"
USER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": EMAIL,
    "email_confirmed_at": "2026-10-17T00:00:00Z",
    "user_metadata": {"name": "Buyer"},
    "is_anonymous": False,
}
PRODUCT_ID = "00000000-0000-4000-8000-000000000001"


class AuthCallbackSecurityTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.returned_user = dict(USER)
        self.transport = httpx.Client(transport=httpx.MockTransport(self.provider))
        self.app = create_app(
            {
                "TESTING": True,
                "HTTP_CLIENT": self.transport,
                "AUDIT_PERSIST": False,
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test",
                "APP_SECRET_KEY": "a" * 48,
                "SITE_URL": ORIGIN,
            }
        )
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def provider(self, request):
        self.requests.append(request)
        path = request.url.path
        if path in ("/auth/v1/recover", "/auth/v1/logout"):
            return httpx.Response(200, json={})
        if path == "/auth/v1/signup":
            return httpx.Response(200, json={"id": USER["id"]})
        if path in ("/auth/v1/verify", "/auth/v1/token"):
            return httpx.Response(
                200,
                json={
                    "access_token": "new-access",
                    "refresh_token": "new-refresh",
                    "user": self.returned_user,
                },
            )
        if path == "/auth/v1/user":
            return httpx.Response(200, json=self.returned_user)
        raise AssertionError("Unexpected provider path: " + path)

    def initiate(self, kind="recovery", email=EMAIL):
        body = {"email": email}
        endpoint = "reset"
        if kind == "signup":
            endpoint = "signup"
            body.update(password="long-password-123", name="Buyer")
        response = self.client.post(
            "/api/auth/" + endpoint,
            json=body,
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(self.client.get_cookie(VERIFIER, domain="shop.example"))
        self.requests.clear()
        return response

    def callback(self, query):
        return self.client.get("/auth/confirm?" + query, base_url=ORIGIN)

    def assert_denied(self, response):
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["Location"], "/account?auth_error=invalid_link")
        self.assertFalse(
            any(
                cookie.startswith((ACCESS + "=new-access", REFRESH + "=new-refresh"))
                for cookie in response.headers.getlist("Set-Cookie")
            )
        )

    def test_attacker_token_hash_cannot_start_a_session_in_fresh_browser(self):
        for kind in ("signup", "email", "recovery", "invite", "email_change"):
            with self.subTest(kind=kind):
                self.assert_denied(self.callback("token_hash=attacker-owned-hash&type=" + kind))
        self.assertFalse(self.requests)

    def test_tampered_state_cannot_exchange_code_or_token_hash(self):
        self.client.set_cookie(VERIFIER, "forged-state", domain="shop.example", secure=True)
        self.assert_denied(self.callback("token_hash=valid-hash&type=recovery"))
        self.assert_denied(self.callback("code=valid-code"))
        self.assertFalse(self.requests)

    def test_expired_state_is_rejected_before_provider_exchange(self):
        self.initiate()
        cookie = self.client.get_cookie(VERIFIER, domain="shop.example").value
        with self.app.app_context():
            state = serializer().loads(cookie)
            with patch("itsdangerous.timed.time.time", return_value=time.time() - FLOW_MAX_AGE - 1):
                expired = serializer().dumps(state)
        self.client.set_cookie(VERIFIER, expired, domain="shop.example", secure=True)
        self.assert_denied(self.callback("token_hash=valid-hash&type=recovery"))
        self.assertFalse(self.requests)

    def test_recovery_token_hash_requires_matching_initiation_and_verified_email(self):
        self.initiate(email="Buyer@Example.com")
        response = self.callback("token_hash=valid-hash&type=recovery&next=/admin")
        self.assertEqual(response.headers["Location"], "/account?recovery=1")
        self.assertEqual(
            [request.url.path for request in self.requests],
            ["/auth/v1/verify", "/auth/v1/user"],
        )
        self.assertEqual(
            json.loads(self.requests[0].content),
            {"token_hash": "valid-hash", "type": "recovery"},
        )
        self.assertEqual(self.client.get_cookie(ACCESS, domain="shop.example").value, "new-access")
        self.assertIsNone(self.client.get_cookie(VERIFIER, domain="shop.example"))

    def test_signup_token_hash_can_complete_matching_flow_without_open_redirect(self):
        self.initiate(kind="signup")
        response = self.callback("token_hash=valid-hash&type=email&next=https://attacker.example")
        self.assertEqual(response.headers["Location"], "/account")
        self.assertEqual(self.client.get_cookie(ACCESS, domain="shop.example").value, "new-access")

    def test_attacker_account_cannot_replace_an_existing_session_during_recovery(self):
        self.initiate()
        self.client.set_cookie(ACCESS, "existing-access", domain="shop.example", secure=True)
        self.returned_user["email"] = "attacker@example.com"
        self.assert_denied(self.callback("token_hash=attacker-owned-hash&type=recovery"))
        self.assertEqual(
            self.client.get_cookie(ACCESS, domain="shop.example").value, "existing-access"
        )

    def test_signup_state_cannot_be_used_for_recovery_type(self):
        self.initiate(kind="signup")
        self.assert_denied(self.callback("token_hash=valid-hash&type=recovery"))
        self.assertFalse(self.requests)

    def test_duplicate_or_mixed_callback_credentials_are_rejected(self):
        for query in (
            "code=first&code=second",
            "token_hash=valid-hash&type=signup&type=recovery",
            "code=valid-code&token_hash=valid-hash&type=recovery",
        ):
            with self.subTest(query=query):
                self.initiate()
                self.assert_denied(self.callback(query))
                self.assertFalse(self.requests)

    def test_pkce_code_flow_remains_browser_bound_and_clears_verifier(self):
        self.initiate()
        response = self.callback("code=valid-code&next=/support")
        self.assertEqual(response.headers["Location"], "/account?recovery=1")
        self.assertEqual(self.requests[0].url.params["grant_type"], "pkce")
        self.assertGreaterEqual(len(json.loads(self.requests[0].content)["code_verifier"]), 43)
        self.assertIsNone(self.client.get_cookie(VERIFIER, domain="shop.example"))

    def test_signout_invalidates_pending_callback_state(self):
        self.initiate()
        self.client.post("/api/auth/logout", json={}, base_url=ORIGIN, headers={"Origin": ORIGIN})
        self.assertIsNone(self.client.get_cookie(VERIFIER, domain="shop.example"))
        self.requests.clear()
        self.assert_denied(self.callback("token_hash=valid-hash&type=recovery"))
        self.assertFalse(self.requests)

    def test_initiation_cookie_does_not_store_plain_email(self):
        response = self.initiate()
        self.assertNotIn(EMAIL, "\n".join(response.headers.getlist("Set-Cookie")))
        with self.app.app_context():
            state = serializer().loads(
                self.client.get_cookie(VERIFIER, domain="shop.example").value
            )
        self.assertNotIn(EMAIL, json.dumps(state))


class UrlValidationSecurityTests(unittest.TestCase):
    def test_product_colors_reject_css_declarations_and_only_accept_six_digit_hex(self):
        for color in (
            "red;position:fixed;inset:0",
            "red;background:url(//evil)",
            "var(--accent)",
            "#fff",
            "#12345g",
            "#1234567",
        ):
            with self.subTest(color=color), self.assertRaises(ApiError):
                product({"id": PRODUCT_ID, "colors": [color]}, partial=True)
        result = product({"id": PRODUCT_ID, "colors": ["#A0BcF9", "#123456"]}, partial=True)
        self.assertEqual(result["colors"], ["#a0bcf9", "#123456"])

    def test_product_images_reject_browser_normalization_and_parser_failures(self):
        for image in (
            "/\\attacker.example/image.png",
            "///attacker.example/image.png",
            "//attacker.example/image.png",
            "/\n/attacker.example/image.png",
            "https://cdn.example/im\nage.png",
            "https://[broken/image.png",
            "https://cdn.example:invalid/image.png",
            "https://user:password@cdn.example/image.png",
            "javascript:alert(1)",
        ):
            with self.subTest(image=image), self.assertRaises(ApiError):
                product({"id": PRODUCT_ID, "images": [image]}, partial=True)

    def test_product_images_preserve_valid_local_and_cdn_paths(self):
        images = ["/static/images/product.webp", "https://cdn.example:443/image.png?w=800"]
        result = product({"id": PRODUCT_ID, "images": images}, partial=True)
        self.assertEqual(result["images"], images)

    def test_origins_reject_ambiguous_controls_and_invalid_ports(self):
        for origin in (
            "https://shop.example\n",
            "https://shop.example:invalid",
            "https://shop.example\\attacker.example",
            "https://user:password@shop.example",
            "https://[broken",
            "https://shop.example/path",
            "http://external.example",
            None,
        ):
            with self.subTest(origin=origin):
                self.assertIsNone(valid_origin(origin))
        self.assertEqual(valid_origin(ORIGIN), ORIGIN)
        self.assertEqual(valid_origin("http://localhost:5052/"), "http://localhost:5052")


if __name__ == "__main__":
    unittest.main()
