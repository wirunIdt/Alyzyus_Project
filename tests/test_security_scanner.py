"""Ensure publication checks detect credential classes without logging their values."""

import base64
import importlib.util
import json
import unittest
from pathlib import Path

FILE = Path(__file__).resolve().parents[1] / "scripts/security-scan.py"
SPEC = importlib.util.spec_from_file_location("security_scan", FILE)
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)


class CredentialScannerTests(unittest.TestCase):
    def test_server_secrets_and_private_keys_are_identified_by_type(self):
        fixtures = {
            b"sb_" + b"secret_" + b"A" * 32: "supabase_secret",
            b"sk_" + b"live_" + b"A" * 32: "stripe_private_key",
            b"whsec_" + b"A" * 32: "stripe_webhook_secret",
            b"ghp_" + b"A" * 36: "github_token",
            b"-----BEGIN " + b"PRIVATE KEY-----": "private_key",
        }
        for token, kind in fixtures.items():
            self.assertEqual(SCAN.credential_types(token), [kind])

    def test_service_role_jwt_is_distinguished_from_public_anon_key(self):
        for role, expected in (("service_role", ["supabase_service_jwt"]), ("anon", [])):
            claims = json.dumps({"role": role, "project": "fixture"}).encode()
            payload = base64.urlsafe_b64encode(claims).rstrip(b"=")
            token = b"eyJhbGciOiJIUzI1NiJ9." + payload + b".fake_signature"
            self.assertEqual(SCAN.credential_types(token), expected)

    def test_empty_placeholders_and_malformed_tokens_do_not_break_scan(self):
        self.assertEqual(SCAN.credential_types(b"sb_secret_test sk_live_ example.env"), [])
        self.assertEqual(SCAN.credential_types(b"eyJheader." + b"a" * 30 + b".signature"), [])


if __name__ == "__main__":
    unittest.main()
