"""Supabase credentials live only in HttpOnly cookies and request-local state."""
import base64
import hashlib
import secrets
from urllib.parse import urlsplit

from flask import Blueprint, current_app, g, jsonify, redirect, request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import validation as v
from .config import auth_configured, valid_origin
from .database import db
from .errors import ApiError

bp = Blueprint("auth", __name__)
ACCESS = "alyzyus_access"
REFRESH = "alyzyus_refresh"
VERIFIER = "alyzyus_pkce"


def configured():
    if not auth_configured(current_app.config):
        raise ApiError("STORE_NOT_CONFIGURED", 503)


def secure_cookie():
    return urlsplit(current_app.config["SITE_URL"]).scheme == "https"


def serializer():
    return URLSafeTimedSerializer(current_app.config["APP_SECRET_KEY"], salt="alyzyus-auth-pkce-v1")


def set_session(session):
    if not isinstance(session, dict) or not session.get("access_token") or not session.get("refresh_token"):
        raise ApiError("AUTH_UNAVAILABLE", 503)
    g.new_session = session
    g.access_token = session["access_token"]
    g.auth_user = session.get("user")


def apply_cookies(response):
    options = {"httponly": True, "secure": secure_cookie(), "samesite": "Lax", "path": "/"}
    if getattr(g, "clear_auth", False):
        for name in (ACCESS, REFRESH, VERIFIER):
            response.delete_cookie(name, **options)
    session = getattr(g, "new_session", None)
    if session:
        # Both persist for the session lifetime; an expired access token is refreshed by the server.
        response.set_cookie(ACCESS, session["access_token"], max_age=30 * 86400, **options)
        response.set_cookie(REFRESH, session["refresh_token"], max_age=30 * 86400, **options)
    if getattr(g, "new_verifier", None):
        response.set_cookie(VERIFIER, g.new_verifier, max_age=3600, **options)
    if getattr(g, "clear_verifier", False):
        response.delete_cookie(VERIFIER, **options)
    return response


def current_user(required=False, verified=False):
    configured()
    if not hasattr(g, "auth_checked"):
        g.auth_checked = True
        g.auth_user = None
        token = request.cookies.get(ACCESS)
        if token:
            try:
                g.auth_user = db().auth("GET", "user", token=token)
                g.access_token = token
            except ApiError as exc:
                if exc.code != "INVALID_CREDENTIALS":
                    raise
        if not g.auth_user and request.cookies.get(REFRESH):
            try:
                session = db().auth("POST", "token", params={"grant_type": "refresh_token"}, body={"refresh_token": request.cookies[REFRESH]})
                set_session(session)
                # Ask the Auth service for the current identity rather than trusting JWT claims.
                g.auth_user = db().auth("GET", "user", token=g.access_token)
            except ApiError as exc:
                if exc.code != "INVALID_CREDENTIALS":
                    raise
                g.clear_auth = True
                g.new_session = None
                g.auth_user = None
        if not g.auth_user and token:
            g.clear_auth = True
    user = g.auth_user
    if required and not user:
        raise ApiError("UNAUTHORIZED", 401)
    if verified and user and (not user.get("email_confirmed_at") or user.get("is_anonymous")):
        raise ApiError("EMAIL_NOT_VERIFIED", 403)
    return user


def profile_role(user):
    rows, _ = db().select("profiles", token=g.access_token, params={"select": "role", "id": "eq." + user["id"], "limit": "1"})
    return rows[0]["role"] if rows else "customer"


def public_user(user):
    if not user:
        return None
    return {"id": user["id"], "email": user.get("email", ""), "name": str(user.get("user_metadata", {}).get("name", ""))[:120], "role": profile_role(user), "emailVerified": bool(user.get("email_confirmed_at")) and not user.get("is_anonymous", False)}


def require_user():
    return current_user(required=True, verified=True)


def require_admin():
    user = require_user()
    if profile_role(user) != "admin":
        raise ApiError("FORBIDDEN", 403)
    return user


def pkce(kind):
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    g.new_verifier = serializer().dumps({"verifier": verifier, "kind": kind})
    return {"code_challenge": challenge, "code_challenge_method": "s256"}


@bp.get("/api/auth/me")
def me():
    if not auth_configured(current_app.config):
        return jsonify(user=None, configured=False)
    return jsonify(user=public_user(current_user()), configured=True)


@bp.post("/api/auth/login")
def login():
    configured()
    value = v.object_fields(v.read_json(), {"email", "password"}, {"email", "password"})
    session = db().auth("POST", "token", params={"grant_type": "password"}, body={"email": v.email(value["email"]), "password": v.password(value["password"])})
    set_session(session)
    g.auth_checked = True
    return jsonify(user=public_user(current_user(required=True)), configured=True)


@bp.post("/api/auth/signup")
def signup():
    configured()
    value = v.object_fields(v.read_json(), {"email", "password", "name"}, {"email", "password", "name"})
    body = {"email": v.email(value["email"]), "password": v.password(value["password"], new=True), "data": {"name": v.string(value["name"], 2, 120)}, **pkce("signup")}
    result = db().auth("POST", "signup", body=body, params={"redirect_to": valid_origin(current_app.config["SITE_URL"]) + "/auth/callback"})
    if result and result.get("access_token"):
        set_session(result)
        g.auth_checked = True
        return jsonify(user=public_user(current_user(required=True)), configured=True, message="Account created.")
    return jsonify(user=None, configured=True, message="Check your email to confirm your account.")


@bp.post("/api/auth/logout")
def logout():
    v.object_fields(v.read_json(), set())
    try:
        if auth_configured(current_app.config):
            user = current_user()
            if user:
                db().auth("POST", "logout", token=g.access_token, params={"scope": "local"})
    finally:
        # Local sign-out must still remove credentials during a provider outage.
        g.clear_auth = True
        g.new_session = None
    return jsonify(user=None, configured=auth_configured(current_app.config))


@bp.post("/api/auth/reset")
def reset():
    configured()
    value = v.object_fields(v.read_json(), {"email"}, {"email"})
    db().auth("POST", "recover", body={"email": v.email(value["email"]), **pkce("recovery")}, params={"redirect_to": valid_origin(current_app.config["SITE_URL"]) + "/auth/callback"})
    return jsonify(message="If the account exists, a recovery link has been sent.")


@bp.post("/api/auth/update-password")
def update_password():
    configured()
    value = v.object_fields(v.read_json(), {"password"}, {"password"})
    require_user()
    db().auth("PUT", "user", token=g.access_token, body={"password": v.password(value["password"], new=True)})
    return jsonify(message="Password updated.")


def safe_next(value):
    origin = valid_origin(current_app.config["SITE_URL"])
    try:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc:
            if f"{parsed.scheme}://{parsed.netloc}" != origin:
                return "/account"
        if parsed.path in ("/account", "/checkout", "/tracking", "/admin") and not parsed.fragment and "\r" not in value and "\n" not in value:
            return parsed.path + ("?" + parsed.query if parsed.query else "")
    except ValueError:
        pass
    return "/account"


@bp.get("/auth/callback")
@bp.get("/auth/confirm")
def callback():
    try:
        configured()
        code = request.args.get("code")
        token_hash = request.args.get("token_hash")
        kind = request.args.get("type")
        next_path = safe_next(request.args.get("next", "/account"))
        if code:
            verifier = serializer().loads(request.cookies.get(VERIFIER, ""), max_age=3600)
            session = db().auth("POST", "token", params={"grant_type": "pkce"}, body={"auth_code": v.string(code, 1, 2048), "code_verifier": verifier["verifier"]})
            kind = verifier.get("kind")
        elif token_hash and kind in ("signup", "email", "recovery", "invite", "email_change"):
            session = db().auth("POST", "verify", body={"token_hash": v.string(token_hash, 1, 2048), "type": kind})
        else:
            raise ApiError("INVALID_INPUT")
        set_session(session)
        g.clear_verifier = True
        return redirect("/account?recovery=1" if kind == "recovery" else next_path, code=303)
    except (ApiError, BadSignature, KeyError, TypeError):
        g.clear_verifier = True
        return redirect("/account?auth_error=invalid_link", code=303)
