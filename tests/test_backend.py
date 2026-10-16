"""HTTP boundary tests; real SQL transaction/RLS tests live in database.test.mjs."""

import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import patch

import httpx

from server import create_app
from server.auth import ACCESS, REFRESH, VERIFIER
from server.errors import ApiError
from server.validation import product

USER_ID = "11111111-1111-4111-8111-111111111111"
ORDER_ID = "22222222-2222-4222-8222-222222222222"
PRODUCT_ID = "00000000-0000-4000-8000-000000000001"
SECOND_PRODUCT = "00000000-0000-4000-8000-000000000002"
KEY = "33333333-3333-4333-8333-333333333333"
ORIGIN = "https://shop.example"
CONFIG = {
    "TESTING": True,
    "SUPABASE_URL": "https://project.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
    "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test",
    "SITE_URL": ORIGIN,
    "APP_SECRET_KEY": "a" * 48,
    "STRIPE_SECRET_KEY": "",
    "STRIPE_WEBHOOK_SECRET": "",
}
USER = {
    "id": USER_ID,
    "email": "buyer@example.com",
    "email_confirmed_at": "2026-10-14T00:00:00Z",
    "user_metadata": {"name": "Buyer", "role": "admin"},
    "is_anonymous": False,
}
ORDER = {
    "id": ORDER_ID,
    "order_number": "ALY-2026-1001",
    "user_id": USER_ID,
    "status": "pending",
    "payment_status": "pending",
    "payment_method": "cod",
    "subtotal": "3290.00",
    "shipping": "0.00",
    "discount": "0.00",
    "total": "3290.00",
    "created_at": "2026-10-14T00:00:00Z",
    "customer_name": "Buyer",
    "email": "buyer@example.com",
    "phone": "0812345678",
    "address": "123 Sample Road, Bangkok",
    "order_items": [
        {
            "product_id": PRODUCT_ID,
            "name": {"en": "Form", "th": "Form", "zh": "Form"},
            "quantity": 1,
            "price": "3290.00",
            "image": "/static/images/sample.svg",
        }
    ],
}


def cart(items=None):
    return {
        "items": items or [{"productId": PRODUCT_ID, "quantity": 1}],
        "customer": {
            "name": "Buyer",
            "email": "Buyer@Example.com",
            "phone": "0812345678",
            "address": "123 Sample Road, Bangkok",
        },
        "paymentMethod": "cod",
        "coupon": "",
        "idempotencyKey": KEY,
    }


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.role = "customer"
        self.user = dict(USER)
        self.order = dict(ORDER)
        self.rpc = []
        self.expired = False
        self.provider_failure = False
        self.transport = httpx.Client(transport=httpx.MockTransport(self.provider))
        self.app = create_app({**CONFIG, "HTTP_CLIENT": self.transport})
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def provider(self, request):
        self.requests.append(request)
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        if self.provider_failure:
            return httpx.Response(
                503, json={"message": "secret diagnostic", "token": "must-not-leak"}
            )
        if path == "/auth/v1/user":
            if self.expired and request.headers.get("authorization") != "Bearer refreshed":
                return httpx.Response(401, json={"error_code": "bad_jwt"})
            return httpx.Response(200, json=self.user)
        if path == "/auth/v1/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "refreshed"
                    if request.url.params.get("grant_type") == "refresh_token"
                    else "access-secret",
                    "refresh_token": "refresh-secret",
                    "expires_in": 3600,
                    "user": self.user,
                },
            )
        if path == "/auth/v1/signup":
            return httpx.Response(200, json={"id": USER_ID})
        if path == "/auth/v1/verify":
            return httpx.Response(
                200,
                json={
                    "access_token": "access-secret",
                    "refresh_token": "refresh-secret",
                    "user": self.user,
                },
            )
        if path in ("/auth/v1/logout", "/auth/v1/recover"):
            return httpx.Response(200, json={})
        if path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"role": self.role}])
        if path == "/rest/v1/rpc/create_order":
            self.rpc.append(body)
            return httpx.Response(200, json=ORDER_ID)
        if path == "/rest/v1/rpc/apply_stripe_event":
            self.rpc.append(body)
            return httpx.Response(204)
        if path == "/rest/v1/orders":
            return httpx.Response(200, json=[self.order], headers={"Content-Range": "0-0/1"})
        if path == "/rest/v1/products":
            return httpx.Response(200, json=[])
        raise AssertionError("Unexpected provider request: " + str(request.url))

    def get(self, path):
        return self.client.get(path, base_url=ORIGIN)

    def post(self, path, body):
        return self.client.post(path, json=body, base_url=ORIGIN, headers={"Origin": ORIGIN})

    def sign_in(self):
        self.client.set_cookie(ACCESS, "access-secret", domain="shop.example", secure=True)

    def test_demo_catalog_and_auth_are_explicit(self):
        demo = create_app(
            {
                "TESTING": True,
                "SUPABASE_URL": "",
                "SUPABASE_PUBLISHABLE_KEY": "",
                "APP_SECRET_KEY": "",
                "HTTP_CLIENT": self.transport,
            }
        ).test_client()
        catalog = demo.get("/api/products").json
        self.assertFalse(catalog["configured"])
        self.assertEqual(len(catalog["products"]), 8)
        self.assertEqual(demo.get("/api/auth/me").json, {"user": None, "configured": False})
        result = demo.post("/api/checkout", json=cart(), headers={"Origin": "http://localhost"})
        self.assertEqual(result.status_code, 503)
        self.assertFalse(self.requests)

    def test_demo_pages_and_missing_product(self):
        demo = create_app(
            {
                "TESTING": True,
                "SUPABASE_URL": "",
                "SUPABASE_PUBLISHABLE_KEY": "",
                "HTTP_CLIENT": self.transport,
            }
        ).test_client()
        for path in (
            "/",
            "/shop",
            "/product/form-wireless",
            "/checkout",
            "/account",
            "/tracking",
            "/admin",
            "/help",
            "/policies",
        ):
            self.assertEqual(demo.get(path).status_code, 200, path)
        self.assertEqual(demo.get("/product/unknown-product").status_code, 404)

    def test_mutations_require_origin_and_json(self):
        response = self.client.post("/api/auth/login", json={}, base_url=ORIGIN)
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            "/api/auth/login",
            json={},
            base_url=ORIGIN,
            headers={"Origin": "https://attacker.example"},
        )
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            "/api/auth/login",
            data="{}",
            content_type="text/plain",
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 415)
        self.assertFalse(self.requests)

    def test_vercel_proxy_scheme_without_trusting_forwarded_host(self):
        with patch.dict(os.environ, {"VERCEL": "1"}):
            app = create_app({**CONFIG, "HTTP_CLIENT": self.transport})
        client = app.test_client()
        response = client.post(
            "/api/auth/logout",
            json={},
            base_url="http://preview.vercel.app",
            headers={"Origin": "https://preview.vercel.app", "X-Forwarded-Proto": "https"},
        )
        self.assertEqual(response.status_code, 200)
        response = client.post(
            "/api/auth/logout",
            json={},
            base_url="http://preview.vercel.app",
            headers={
                "Origin": "https://attacker.example",
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "attacker.example",
            },
        )
        self.assertEqual(response.status_code, 403)

    def test_malformed_and_oversized_payloads(self):
        response = self.client.post(
            "/api/checkout",
            data="{",
            content_type="application/json",
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 400)
        response = self.post("/api/checkout", {"padding": "x" * (64 * 1024)})
        self.assertEqual(response.status_code, 413)

    def test_checkout_rejects_duplicate_fractional_and_client_total(self):
        for value in (
            cart([{"productId": PRODUCT_ID, "quantity": 1.2}]),
            cart([{"productId": PRODUCT_ID, "quantity": True}]),
            cart(
                [{"productId": PRODUCT_ID, "quantity": 1}, {"productId": PRODUCT_ID, "quantity": 1}]
            ),
            {**cart(), "total": 1},
        ):
            self.assertEqual(self.post("/api/checkout", value).status_code, 400)
        self.assertFalse(self.requests)

    def test_customer_isolation_on_orders(self):
        self.sign_in()
        response = self.get("/api/orders?user_id=another-buyer")
        self.assertEqual(response.status_code, 200)
        query = self.requests[-1]
        self.assertEqual(query.url.params["user_id"], "eq." + USER_ID)
        self.assertEqual(query.headers["authorization"], "Bearer access-secret")
        self.assertEqual(query.headers["apikey"], "sb_publishable_test")
        self.assertEqual(response.json["orders"][0]["total"], 3290)
        self.assertNotIn("request_fingerprint", response.json["orders"][0])

    def test_metadata_cannot_grant_admin(self):
        self.sign_in()
        self.assertEqual(self.get("/api/admin").status_code, 403)
        self.assertEqual(self.get("/api/auth/me").json["user"]["role"], "customer")

    def test_admin_overview_requires_profile_role(self):
        self.role = "admin"
        self.sign_in()
        response = self.get("/api/admin")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["totalOrderCount"], 1)
        self.assertEqual(response.json["orderLimit"], 500)

    def test_unverified_buyer_cannot_checkout(self):
        self.user["email_confirmed_at"] = None
        self.sign_in()
        response = self.post("/api/checkout", cart())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"]["code"], "EMAIL_NOT_VERIFIED")
        self.assertFalse(self.rpc)

    def test_checkout_server_actor_and_stable_fingerprint(self):
        self.sign_in()
        items = [
            {"productId": PRODUCT_ID, "quantity": 1},
            {"productId": SECOND_PRODUCT, "quantity": 2},
        ]
        response = self.post("/api/checkout", cart(items))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["order"]["total"], 3290)
        self.assertEqual(self.rpc[-1]["p_user_id"], USER_ID)
        self.assertEqual(self.rpc[-1]["p_customer"]["email"], "buyer@example.com")
        fingerprint = self.rpc[-1]["p_request_fingerprint"]
        self.post("/api/checkout", cart(list(reversed(items))))
        self.assertEqual(self.rpc[-1]["p_request_fingerprint"], fingerprint)
        rpc_request = next(
            request for request in self.requests if request.url.path.endswith("rpc/create_order")
        )
        self.assertEqual(rpc_request.headers["apikey"], "sb_secret_test")
        self.assertNotIn("authorization", rpc_request.headers)

    def test_signin_tokens_are_http_only_not_json(self):
        response = self.post(
            "/api/auth/login", {"email": "buyer@example.com", "password": "valid-password"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access-secret", response.get_data(as_text=True))
        for cookie in response.headers.getlist("Set-Cookie"):
            self.assertIn("HttpOnly", cookie)
            self.assertIn("Secure", cookie)
            self.assertIn("SameSite=Lax", cookie)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")

    def test_expired_session_refreshes_in_request(self):
        self.expired = True
        self.sign_in()
        self.client.set_cookie(REFRESH, "old-refresh", domain="shop.example", secure=True)
        response = self.get("/api/auth/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["user"]["id"], USER_ID)
        self.assertTrue(
            any("refreshed" in cookie for cookie in response.headers.getlist("Set-Cookie"))
        )

    def test_logout_clears_local_cookies_during_provider_outage(self):
        self.sign_in()
        self.provider_failure = True
        response = self.post("/api/auth/logout", {})
        self.assertEqual(response.status_code, 503)
        cookies = response.headers.getlist("Set-Cookie")
        self.assertTrue(any(ACCESS in cookie and "Max-Age=0" in cookie for cookie in cookies))
        self.assertTrue(any(REFRESH in cookie and "Max-Age=0" in cookie for cookie in cookies))

    def test_signup_uses_signed_pkce_cookie(self):
        response = self.post(
            "/api/auth/signup",
            {"email": "buyer@example.com", "password": "strong-password-12", "name": "Buyer"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["user"])
        self.assertTrue(
            any(
                VERIFIER in cookie and "HttpOnly" in cookie
                for cookie in response.headers.getlist("Set-Cookie")
            )
        )
        request = self.requests[-1]
        payload = json.loads(request.content)
        self.assertEqual(payload["code_challenge_method"], "s256")
        self.assertNotIn("code_verifier", payload)
        response = self.get("/auth/callback?code=valid-code&next=https://attacker.example")
        self.assertEqual(response.headers["Location"], "/account")
        self.assertTrue(any(ACCESS in cookie for cookie in response.headers.getlist("Set-Cookie")))

    def test_callback_without_verifier_cannot_establish_session(self):
        response = self.get("/auth/callback?code=stolen-code&next=//attacker.example")
        self.assertEqual(response.headers["Location"], "/account?auth_error=invalid_link")
        self.assertFalse(self.requests)

    def test_recovery_token_callback(self):
        response = self.get("/auth/confirm?token_hash=valid-hash&type=recovery&next=/admin")
        self.assertEqual(response.headers["Location"], "/account?recovery=1")
        self.assertEqual(
            json.loads(self.requests[-1].content), {"token_hash": "valid-hash", "type": "recovery"}
        )

    def test_provider_diagnostics_are_redacted(self):
        self.sign_in()
        self.provider_failure = True
        response = self.get("/api/orders")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret diagnostic", response.get_data(as_text=True))
        self.assertNotIn("must-not-leak", response.get_data(as_text=True))

    def test_configured_catalog_does_not_fall_back_to_demo(self):
        self.provider_failure = True
        response = self.get("/api/products")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("Form Wireless", response.get_data(as_text=True))

    def test_payment_settings_and_public_health_do_not_leak(self):
        self.assertFalse(self.get("/api/settings").json["payments"]["card"])
        self.assertFalse(self.get("/api/settings").json["payments"]["bank_transfer"])
        self.app.config.update(
            STRIPE_SECRET_KEY="sk_test_secret",
            STRIPE_WEBHOOK_SECRET="whsec_secret",
            BANK_NAME="Bank",
            BANK_ACCOUNT_NAME="Owner",
            BANK_ACCOUNT_NUMBER="123",
        )
        self.assertTrue(self.get("/api/settings").json["payments"]["card"])
        self.assertTrue(self.get("/api/settings").json["payments"]["bank_transfer"])
        self.assertEqual(self.get("/api/health").json, {"status": "ok", "store": "Alyzyus"})
        self.assertNotIn("sk_test_secret", self.get("/api/settings").get_data(as_text=True))

    def signed_event(self, session):
        self.app.config["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
        event = {"id": "evt_1", "type": "checkout.session.completed", "data": {"object": session}}
        body = json.dumps(event).encode()
        timestamp = int(time.time())
        signature = hmac.new(
            b"whsec_test", str(timestamp).encode() + b"." + body, hashlib.sha256
        ).hexdigest()
        return self.client.post(
            "/api/webhooks/stripe",
            data=body,
            base_url=ORIGIN,
            content_type="application/json",
            headers={"Stripe-Signature": f"t={timestamp},v1={signature}"},
        )

    def test_webhook_signature_and_matching_identity(self):
        self.app.config["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
        response = self.client.post(
            "/api/webhooks/stripe", json={}, base_url=ORIGIN, headers={"Stripe-Signature": "bad"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.rpc)
        self.order["payment_method"] = "card"
        session = {
            "id": "cs_test_1",
            "payment_status": "paid",
            "client_reference_id": ORDER_ID,
            "currency": "thb",
            "amount_total": 329000,
            "payment_intent": "pi_test",
            "metadata": {"order_id": ORDER_ID, "user_id": USER_ID, "checkout_method": "card"},
        }
        self.assertEqual(self.signed_event(session).status_code, 200)
        self.assertEqual(self.rpc[-1]["p_amount"], 329000)
        self.assertEqual(self.rpc[-1]["p_event_id"], "evt_1")
        self.rpc.clear()
        self.assertEqual(self.signed_event({**session, "currency": "usd"}).status_code, 400)
        self.assertFalse(self.rpc)

    def test_simulation_query_allowlist(self):
        response = self.get(
            "/simulation?mode=product&product="
            + PRODUCT_ID
            + "&order=bad&locale=zh&next=https://attacker.example"
        )
        self.assertEqual(response.status_code, 307)
        self.assertEqual(
            response.headers["Location"],
            "/static/queue3d.html?mode=product&locale=zh&product=" + PRODUCT_ID,
        )

    def test_product_validation_rejects_unsafe_images_and_prices(self):
        for value in (
            {"id": PRODUCT_ID, "images": ["javascript:alert(1)"]},
            {"id": PRODUCT_ID, "price": 1.001},
            {"id": PRODUCT_ID, "stock": True},
            {"id": PRODUCT_ID, "name": {"en": "Name"}},
        ):
            with self.assertRaises(ApiError):
                product(value, partial=True)

    def test_oversized_integer_price_returns_validation_error_instead_of_500(self):
        self.role = "admin"
        self.sign_in()
        response = self.client.patch(
            "/api/admin/products",
            json={"id": PRODUCT_ID, "price": 10**1000},
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["error"]["code"], "INVALID_INPUT")
        self.assertFalse(any(request.method == "PATCH" for request in self.requests))


if __name__ == "__main__":
    unittest.main()
