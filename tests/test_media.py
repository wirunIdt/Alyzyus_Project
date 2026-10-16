"""Exercise upload authorization, image decoding, and translation failures."""

import io
import struct
import unittest
import zlib

import httpx
from PIL import Image

from server import create_app
from server.auth import ACCESS
from server.errors import ApiError
from server.media import _cache, optimized_image

ORIGIN = "http://localhost"
USER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "owner@example.com",
    "email_confirmed_at": "2026-10-14T00:00:00Z",
    "is_anonymous": False,
    "user_metadata": {},
}


def image_bytes(format="PNG", size=(20, 16)):
    output = io.BytesIO()
    Image.new("RGB", size, "#7254c8").save(output, format)
    return output.getvalue()


class MediaTests(unittest.TestCase):
    def setUp(self):
        _cache.clear()
        self.requests = []
        self.translation_calls = 0
        self.quota = False
        self.translation_data = None
        self.role = "admin"
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
        _cache.clear()

    def provider(self, request):
        self.requests.append(request)
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json=USER)
        if request.url.path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"role": self.role}])
        if request.url.path.startswith("/storage/v1/bucket/"):
            return httpx.Response(200, json={"id": "product-images", "public": True})
        if request.url.path.startswith("/storage/v1/object/product-images/"):
            return httpx.Response(200, json={"Key": request.url.path})
        if request.url.host == "api.mymemory.translated.net":
            self.translation_calls += 1
            if self.translation_data is not None:
                return httpx.Response(200, json=self.translation_data)
            return httpx.Response(
                200,
                json={
                    "responseStatus": 403 if self.quota else 200,
                    "quotaFinished": self.quota,
                    "responseData": {"translatedText": "trans " + request.url.params["q"]},
                },
            )
        return httpx.Response(404)

    def sign_in(self):
        self.client.set_cookie(ACCESS, "verified-access")

    def test_real_images_are_resized_and_reencoded_without_metadata(self):
        image = optimized_image(image_bytes("JPEG", (1800, 300)))
        with Image.open(io.BytesIO(image)) as decoded:
            self.assertEqual(decoded.format, "WEBP")
            self.assertEqual(decoded.width, 1600)
            self.assertFalse(decoded.getexif())

    def test_palette_png_retains_transparent_background(self):
        source = Image.new("P", (20, 16), 0)
        source.putpalette([114, 84, 200] + [0, 0, 0] * 255)
        raw = io.BytesIO()
        source.save(raw, "PNG", transparency=0)
        image = optimized_image(raw.getvalue())
        with Image.open(io.BytesIO(image)) as decoded:
            self.assertIn("A", decoded.getbands())
            self.assertEqual(decoded.getpixel((0, 0))[3], 0)

    def test_svg_and_oversized_dimensions_are_rejected_before_decode(self):
        for raw in (b"<svg><script>alert(1)</script></svg>",):
            with self.assertRaises(ApiError) as failure:
                optimized_image(raw)
            self.assertEqual(failure.exception.code, "INVALID_IMAGE")
        raw = bytearray(image_bytes())
        raw[16:24] = struct.pack(">II", 5000, 4000)
        raw[29:33] = struct.pack(">I", zlib.crc32(raw[12:29]))
        with self.assertRaises(ApiError):
            optimized_image(bytes(raw))

    def test_image_byte_limit_is_enforced(self):
        with self.assertRaises(ApiError) as failure:
            optimized_image(b"x" * 850001)
        self.assertEqual(failure.exception.status, 413)

    def test_anonymous_and_customer_cannot_upload_or_translate(self):
        payload = {"source": "th", "name": "x", "description": "y"}
        self.assertEqual(
            self.client.post(
                "/api/admin/translate", json=payload, headers={"Origin": ORIGIN}
            ).status_code,
            401,
        )
        self.sign_in()
        self.role = "customer"
        response = self.client.post(
            "/api/admin/images",
            data={"file": (io.BytesIO(image_bytes()), "safe.png")},
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(any("/storage/" in r.url.path for r in self.requests))

    def test_media_origin_and_mime_guards_remain_required(self):
        self.sign_in()
        self.assertEqual(
            self.client.post(
                "/api/admin/images",
                data={"file": (io.BytesIO(image_bytes()), "safe.png")},
                headers={"Origin": "https://other.example"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post("/api/admin/images", json={}, headers={"Origin": ORIGIN}).status_code,
            415,
        )

    def test_admin_upload_uses_unique_storage_path_and_public_image_url(self):
        self.sign_in()
        response = self.client.post(
            "/api/admin/images",
            data={"file": (io.BytesIO(image_bytes()), "fake.svg")},
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("/storage/v1/object/public/product-images/products/", response.json["url"])
        request = next(r for r in self.requests if "/storage/v1/object/" in r.url.path)
        self.assertEqual(request.headers["Content-Type"], "image/webp")
        self.assertEqual(request.headers["x-upsert"], "false")
        with Image.open(io.BytesIO(request.content)) as decoded:
            self.assertEqual(decoded.format, "WEBP")

    def test_translation_cache_and_quota_failure_do_not_create_fake_translations(self):
        self.sign_in()
        payload = {"source": "th", "name": "test name", "description": "test description"}
        response = self.client.post(
            "/api/admin/translate", json=payload, headers={"Origin": ORIGIN}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json["name"]), {"th", "en", "zh"})
        self.assertEqual(response.json["name"]["th"], "test name")
        self.assertTrue(response.json["reviewRequired"])
        self.assertEqual(self.translation_calls, 4)
        self.client.post("/api/admin/translate", json=payload, headers={"Origin": ORIGIN})
        self.assertEqual(self.translation_calls, 4)
        self.quota = True
        payload["name"] = "different name"
        payload["description"] = "different description"
        failure = self.client.post("/api/admin/translate", json=payload, headers={"Origin": ORIGIN})
        self.assertEqual(failure.status_code, 503)
        self.assertNotIn("name", failure.json)

    def test_malformed_translation_provider_data_returns_controlled_unavailable(self):
        self.sign_in()
        payload = {"source": "th", "name": "source name", "description": "source description"}
        cases = [
            [],
            "unavailable",
            {"responseStatus": 200, "responseData": None},
            {"responseStatus": 200, "responseData": []},
            {"responseStatus": 200, "responseData": {"translatedText": 42}},
        ]
        for data in cases:
            with self.subTest(data=data):
                self.translation_data = data
                failure = self.client.post(
                    "/api/admin/translate", json=payload, headers={"Origin": ORIGIN}
                )
                self.assertEqual(failure.status_code, 503)
                self.assertEqual(failure.json["error"]["code"], "TRANSLATION_UNAVAILABLE")
                self.assertNotIn("name", failure.json)


if __name__ == "__main__":
    unittest.main()
