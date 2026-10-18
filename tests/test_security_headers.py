"""Security policies must survive dynamic templates, static HTML and error responses."""

import base64
import hashlib
import io
import re
import unittest
from unittest.mock import patch

from flask import request
from werkzeug.test import EnvironBuilder

from server import create_app
from server.security import InlineScripts, script_hashes


class BrowserSecurityTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(
            {"TESTING": True, "SUPABASE_URL": "", "SITE_URL": "https://shop.example"}
        )
        self.client = self.app.test_client()

    def test_fresh_nonce_matches_inline_scripts_and_not_unsafe_eval(self):
        first = self.client.get("/account", base_url="https://shop.example")
        second = self.client.get("/account", base_url="https://shop.example")
        policy = first.headers["Content-Security-Policy"]
        nonce = re.search(r"'nonce-([^']+)'", policy)[1]
        self.assertNotIn(nonce, second.headers["Content-Security-Policy"])
        scripts = re.findall(r"<script([^>]*)>", first.get_data(as_text=True))
        for attrs in scripts:
            if "src=" not in attrs:
                self.assertIn('nonce="' + nonce + '"', attrs)
        self.assertNotIn("'unsafe-eval'", policy)
        self.assertNotIn("'unsafe-inline'", policy.split("script-src ", 1)[1].split(";", 1)[0])
        self.assertIn("script-src-attr 'none'", policy)
        self.assertEqual(first.headers["Cache-Control"], "private, no-store")

    def test_static_inline_script_hashes_match_wire_html(self):
        for path in ("/static/queue3d.html", "/offline.html"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            parser = InlineScripts()
            parser.feed(response.get_data(as_text=True).replace("\r\n", "\n").replace("\r", "\n"))
            self.assertTrue(parser.scripts)
            for source in parser.scripts:
                digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
                self.assertIn(
                    "'sha256-" + digest + "'", response.headers["Content-Security-Policy"]
                )
            response.close()
        self.assertEqual(len(script_hashes()), 2)

    def test_errors_have_security_headers_and_https_hsts(self):
        for path in ("/missing", "/api/missing"):
            response = self.client.get(path, base_url="https://shop.example")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["Strict-Transport-Security"], "max-age=31536000")
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        self.assertNotIn("Strict-Transport-Security", self.client.get("/account").headers)

    def test_host_header_cannot_select_an_untrusted_origin(self):
        response = self.client.get("/account", base_url="https://attacker.example")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("attacker.example", response.get_data(as_text=True))

    def test_runtime_does_not_require_public_assets_in_the_function_bundle(self):
        with patch("server.security.script_hashes", side_effect=FileNotFoundError):
            app = create_app({"TESTING": True, "SUPABASE_URL": ""})
            self.assertEqual(app.test_client().get("/account").status_code, 200)

    def test_bounded_multipart_and_body_parser(self):
        @self.app.post("/parse-multipart")
        def parse():
            return {"parts": len(request.files) + len(request.form)}

        safe = {"file": (io.BytesIO(b"small"), "sample.txt")}
        self.assertEqual(self.client.post("/parse-multipart", data=safe).status_code, 200)
        excessive = {str(i): "value" for i in range(9)}
        self.assertEqual(
            self.client.post(
                "/parse-multipart", data=excessive, content_type="multipart/form-data"
            ).status_code,
            413,
        )
        valid_upload = {"file": (io.BytesIO(b"x" * 850000), "image.webp")}
        builder = EnvironBuilder(path="/parse-multipart", method="POST", data=valid_upload)
        environ = builder.get_environ()
        try:
            response = self.client.open(environ)
            self.assertEqual(response.status_code, 200)
            response.close()
        finally:
            environ["wsgi.input"].close()
            builder.close()
        self.assertEqual(self.app.config["MAX_FORM_MEMORY_SIZE"], 131072)
        self.assertEqual(self.app.config["MAX_FORM_PARTS"], 8)


if __name__ == "__main__":
    unittest.main()
