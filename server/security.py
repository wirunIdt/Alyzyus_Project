"""Browser security policies and bounded request parsing, without runtime dependencies."""

import base64
import hashlib
import os
import secrets
from html.parser import HTMLParser
from urllib.parse import urlsplit

from flask import g, request

from .config import ROOT, valid_origin

THREE_SOURCE = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js"
STATIC_HTML = ("public/static/queue3d.html", "public/offline.html")


class InlineScripts(HTMLParser):
    """HTML normalizes line endings before checking CSP hashes."""

    def __init__(self):
        super().__init__()
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and "src" not in attributes:
            if attributes.get("type", "text/javascript") in (
                "text/javascript",
                "application/javascript",
                "module",
            ):
                self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.scripts.append("".join(self.current))
            self.current = None


def script_hashes():
    hashes = []
    for name in STATIC_HTML:
        parser = InlineScripts()
        parser.feed((ROOT / name).read_text(encoding="utf-8"))
        for source in parser.scripts:
            digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
            hashes.append("'sha256-" + digest + "'")
    return tuple(hashes)


def content_policy(hashes=(), nonce=None):
    scripts = ["'self'", THREE_SOURCE, *hashes]
    if nonce:
        scripts.append("'nonce-" + nonce + "'")
    return "; ".join(
        (
            "default-src 'self'",
            "script-src " + " ".join(scripts),
            "script-src-attr 'none'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' https: data: blob:",
            "connect-src 'self'",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
        )
    )


def standard_headers():
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }


def init_security(app):
    # จำกัด multipart เพิ่มเติม: ไม่ยอมให้ส่งฟิลด์เล็กหลายพันรายการในคำขอเดียว
    app.config["MAX_FORM_MEMORY_SIZE"] = min(
        app.config.get("MAX_FORM_MEMORY_SIZE") or 128 * 1024, 128 * 1024
    )
    app.config["MAX_FORM_PARTS"] = min(app.config.get("MAX_FORM_PARTS") or 8, 8)
    if app.config.get("TRUSTED_HOSTS") is None:
        hosts = set()
        origin = valid_origin(app.config["SITE_URL"])
        if origin:
            hosts.add(urlsplit(origin).hostname)
        for name in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
            host = os.environ.get(name, "")
            candidate = valid_origin("https://" + host) if host else None
            if candidate:
                hosts.add(urlsplit(candidate).hostname)
        if os.environ.get("VERCEL") != "1":
            hosts.update(("localhost", "127.0.0.1", "[::1]"))
        app.config["TRUSTED_HOSTS"] = sorted(hosts)
    # Vercel may serve public/ only from its CDN. Runtime must not read those files.
    from .csp_hashes import STATIC_SCRIPT_HASHES

    hashes = STATIC_SCRIPT_HASHES

    def nonce():
        if "csp_nonce" not in g:
            g.csp_nonce = secrets.token_urlsafe(24)
        return g.csp_nonce

    @app.context_processor
    def template_security():
        return {"csp_nonce": nonce()}

    @app.after_request
    def browser_security(response):
        response.headers.update(standard_headers())
        response.headers["Content-Security-Policy"] = content_policy(hashes, nonce())
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response
