"""Supabase REST transport with one stateless connection pool per app."""
import json

import httpx
from flask import current_app

from .config import ROOT, database_configured
from .errors import ApiError, STATUS


class Supabase:
    def __init__(self, config, client=None):
        self.config = config
        self.client = client or httpx.Client(timeout=httpx.Timeout(20, connect=5), limits=httpx.Limits(max_connections=30, max_keepalive_connections=15), follow_redirects=False)

    def call(self, method, path, *, token=None, admin=False, body=None, params=None, prefer=None, auth=False):
        if not database_configured(self.config):
            raise ApiError("STORE_NOT_CONFIGURED", 503)
        key = self.config["SUPABASE_SERVICE_ROLE_KEY"] if admin else self.config["SUPABASE_PUBLISHABLE_KEY"]
        if not key:
            raise ApiError("STORE_NOT_CONFIGURED", 503)
        # Never mutate pool-wide authentication state or send pooled provider cookies.
        headers = {"apikey": key, "Accept": "application/json", "Cookie": ""}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        elif not key.startswith(("sb_publishable_", "sb_secret_")):
            headers["Authorization"] = f"Bearer {key}"
        if prefer:
            headers["Prefer"] = prefer
        try:
            response = self.client.request(method, self.config["SUPABASE_URL"] + path, json=body, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise ApiError("AUTH_UNAVAILABLE" if auth else "DATABASE_ERROR", 503) from exc
        try:
            data = response.json() if response.content else None
        except ValueError:
            data = None
        if response.is_error:
            detail = data if isinstance(data, dict) else {}
            if auth:
                code = detail.get("error_code") or detail.get("code")
                if response.status_code == 429:
                    raise ApiError("RATE_LIMITED", 429)
                if response.status_code >= 500:
                    raise ApiError("AUTH_UNAVAILABLE", 503)
                if code == "email_not_confirmed":
                    raise ApiError("EMAIL_NOT_VERIFIED", 403)
                if response.status_code in (400, 401, 403, 422):
                    raise ApiError("INVALID_CREDENTIALS", 401)
                raise ApiError("AUTH_UNAVAILABLE", 503)
            code = detail.get("message")
            if code in STATUS:
                raise ApiError(code)
            if detail.get("code") == "23505":
                raise ApiError("PRODUCT_ALREADY_EXISTS", 409)
            current_app.logger.warning("Database request failed (status=%s, code=%s)", response.status_code, detail.get("code", "unknown"))
            raise ApiError("DATABASE_ERROR", 503)
        return data, response.headers

    def auth(self, method, endpoint, *, token=None, body=None, params=None):
        return self.call(method, "/auth/v1/" + endpoint, token=token, body=body, params=params, auth=True)[0]

    def select(self, table, *, token=None, admin=False, params=None, count=False):
        return self.call("GET", "/rest/v1/" + table, token=token, admin=admin, params=params, prefer="count=exact" if count else None)

    def rpc(self, function, body):
        return self.call("POST", "/rest/v1/rpc/" + function, admin=True, body=body)[0]


def db():
    return current_app.extensions["supabase"]


def map_product(row):
    result = {key: row[key] for key in ("id", "slug", "name", "description", "category", "stock", "images", "colors", "featured", "active") if key in row}
    result["price"] = float(row["price"])
    if row.get("compare_at") is not None:
        result["compareAt"] = float(row["compare_at"])
    if row.get("badge"):
        result["badge"] = row["badge"]
    return result


def map_order(row):
    keys = ("id", "order_number", "status", "payment_status", "payment_method", "created_at", "tracking_number", "carrier", "customer_name", "email", "phone", "address")
    result = {key: row.get(key) for key in keys}
    result.update({key: float(row.get(key, 0)) for key in ("subtotal", "shipping", "discount", "total")})
    result["items"] = [{"product_id": item["product_id"], "name": item["name"], "quantity": int(item["quantity"]), "price": float(item["price"]), "image": item.get("image", "")} for item in row.get("order_items", row.get("items", []))]
    return result


def catalog():
    if not database_configured(current_app.config):
        with (ROOT / "data" / "demo-products.json").open(encoding="utf-8") as source:
            return {"products": json.load(source), "configured": False}
    rows, _ = db().select("products", params={"select": "*", "active": "eq.true", "order": "featured.desc,created_at.desc"})
    return {"products": [map_product(row) for row in rows or []], "configured": True}


def single(rows, code="ORDER_NOT_FOUND"):
    if not isinstance(rows, list) or len(rows) != 1:
        raise ApiError(code, 404)
    return rows[0]
