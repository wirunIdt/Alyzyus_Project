"""Portfolio demo and public read fallback never confer real account/order access."""

import json
import unittest
from unittest.mock import patch

import httpx
from test_backend import CONFIG, ORIGIN, cart

from server import create_app
from server.demo import bp
from server.errors import ApiError


class PortfolioDemoTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def unavailable(request):
            self.calls.append(request)
            return httpx.Response(503, json={"message": "fixture-private-diagnostic"})

        self.transport = httpx.Client(transport=httpx.MockTransport(unavailable))
        self.app = create_app({**CONFIG, "HTTP_CLIENT": self.transport})
        if bp.name not in self.app.blueprints:
            self.app.register_blueprint(bp)
        self.client = self.app.test_client()

    def tearDown(self):
        self.transport.close()

    def test_demo_works_without_database_auth_or_shared_admin_credentials(self):
        response = self.client.get("/demo?role=admin", base_url=ORIGIN)
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn("PORTFOLIO DEMO", body)
        self.assertIn("ข้อมูลจำลองทั้งหมด", body)
        self.assertIn("demo-admin-panel", body)
        self.assertIn("/static/js/demo.js", body)
        self.assertNotIn("/static/js/app.js", body)
        self.assertNotIn("sb_secret", body)
        self.assertNotIn("alyzyus_access=", response.headers.get("Set-Cookie", ""))
        self.assertEqual(self.calls, [])
        self.assertIn("private, no-store", response.headers["Cache-Control"])

    def test_public_catalog_outage_is_explicitly_browse_only_and_never_writes(self):
        response = self.client.get("/api/products", base_url=ORIGIN)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["configured"])
        self.assertTrue(response.json["catalogFallback"])
        self.assertEqual(len(response.json["products"]), 8)
        page = self.client.get("/shop", base_url=ORIGIN)
        self.assertEqual(page.status_code, 200)
        self.assertIn("บริการร้านค้าชั่วคราวไม่พร้อม", page.get_data(as_text=True))
        self.assertNotIn("fixture-private-diagnostic", page.get_data(as_text=True))
        self.assertTrue(self.calls)
        self.assertTrue(all(request.method == "GET" for request in self.calls))

    def test_healthy_empty_real_catalog_remains_empty_instead_of_inventing_products(self):
        with patch("server.database.Supabase.select", return_value=([], {})):
            response = self.client.get("/api/products", base_url=ORIGIN)
        self.assertEqual(response.json, {"products": [], "configured": True})

    def test_fallback_does_not_hide_unrelated_validation_or_permission_failures(self):
        with patch("server.database.Supabase.select", side_effect=ApiError("FORBIDDEN", 403)):
            response = self.client.get("/api/products", base_url=ORIGIN)
        self.assertEqual(response.status_code, 403)

    def test_demo_role_never_bypasses_real_admin_or_checkout(self):
        self.client.get("/demo?role=admin", base_url=ORIGIN)
        self.assertEqual(self.client.get("/api/admin", base_url=ORIGIN).status_code, 401)
        response = self.client.post(
            "/api/checkout", json=cart(), base_url=ORIGIN, headers={"Origin": ORIGIN}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])
        response = self.client.post("/demo", json={}, base_url=ORIGIN, headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 405)
        self.assertEqual(self.calls, [])

    def test_demo_json_contains_only_public_product_fields_and_csp_nonce(self):
        from html.parser import HTMLParser

        class DataScript(HTMLParser):
            def __init__(self):
                super().__init__()
                self.active = False
                self.source = ""
                self.nonce = None

            def handle_starttag(self, tag, attrs):
                values = dict(attrs)
                self.active = tag == "script" and values.get("id") == "demo-data"
                if self.active:
                    self.nonce = values.get("nonce")

            def handle_data(self, data):
                if self.active:
                    self.source += data

            def handle_endtag(self, tag):
                if tag == "script":
                    self.active = False

        response = self.client.get("/demo", base_url=ORIGIN)
        parser = DataScript()
        parser.feed(response.get_data(as_text=True))
        products = json.loads(parser.source)
        self.assertEqual(len(products), 6)
        self.assertEqual(set(products[0]), {"id", "name", "category", "price", "stock", "images"})
        self.assertIn("'nonce-" + parser.nonce + "'", response.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
