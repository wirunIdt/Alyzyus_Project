"""App factory for local tests and the Vercel Python runtime."""
import atexit
import os

from dotenv import load_dotenv
from flask import Flask, current_app, render_template, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import ROOT, database_configured, environment, valid_origin
from .database import Supabase
from .errors import ApiError, error_response


def create_app(overrides=None):
    load_dotenv(ROOT / ".env", override=False)
    static_path = ROOT / "public" / "static"
    if not static_path.exists():
        static_path = ROOT / "static"
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(static_path), static_url_path="/static")
    app.config.update(environment())
    if overrides:
        app.config.update(overrides)
    if os.environ.get("VERCEL") == "1":
        # Vercel supplies the proxy scheme. Host and client IP stay untrusted.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=0, x_proto=1, x_host=0, x_port=0, x_prefix=0)
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    pool = Supabase(app.config, client=app.config.get("HTTP_CLIENT"))
    app.extensions["supabase"] = pool
    if not app.config.get("HTTP_CLIENT"):
        atexit.register(pool.client.close)

    from .api import bp as api
    from .auth import apply_cookies, bp as auth
    from .views import bp as pages
    from .media import bp as media
    app.register_blueprint(api)
    app.register_blueprint(auth)
    app.register_blueprint(pages)
    app.register_blueprint(media)

    @app.before_request
    def protect_mutations():
        if request.path.startswith("/api/") and request.method in ("POST", "PATCH", "PUT", "DELETE") and request.path != "/api/webhooks/stripe":
            expected = request.host_url.rstrip("/")
            canonical = valid_origin(current_app.config["SITE_URL"])
            # Use the configured HTTPS scheme on its exact host behind Vercel's proxy.
            if canonical and canonical.split("://", 1)[1] == request.host:
                expected = canonical
            if not request.headers.get("Origin") or request.headers["Origin"] != expected:
                raise ApiError("INVALID_ORIGIN", 403)
            if request.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
                raise ApiError("INVALID_ORIGIN", 403)
            expected_type = "multipart/form-data" if request.path == "/api/admin/images" and request.method == "POST" else "application/json"
            if request.mimetype != expected_type:
                raise ApiError("INVALID_CONTENT_TYPE", 415)

    @app.after_request
    def response_headers(response):
        apply_cookies(response)
        if not request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(ApiError)
    def known_error(error):
        if request.path.startswith("/api/"):
            return error_response(error)
        return render_template("error.html", status=error.status, bootstrap={"products": [], "configured": database_configured(app.config)}), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            codes = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 413: "PAYLOAD_TOO_LARGE"}
            return error_response(ApiError(codes.get(error.code, "INVALID_INPUT"), error.code))
        return render_template("error.html", status=error.code, bootstrap={"products": [], "configured": database_configured(app.config)}), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        # Log the exception class only; request payloads or provider tokens may contain secrets.
        app.logger.error("Request failed (%s)", type(error).__name__)
        if request.path.startswith("/api/"):
            return error_response(ApiError("INTERNAL_ERROR", 500))
        return render_template("error.html", status=500, bootstrap={"products": [], "configured": database_configured(app.config)}), 500

    return app
