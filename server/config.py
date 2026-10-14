"""Configuration stays on the server; credentials are never rendered."""
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def environment() -> dict:
    return {
        "SUPABASE_URL": os.getenv("SUPABASE_URL", os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")).strip().rstrip("/"),
        "SUPABASE_PUBLISHABLE_KEY": os.getenv("SUPABASE_PUBLISHABLE_KEY", os.getenv("SUPABASE_ANON_KEY", os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""))).strip(),
        "SUPABASE_SERVICE_ROLE_KEY": os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
        "SITE_URL": os.getenv("SITE_URL", os.getenv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")).strip().rstrip("/"),
        "APP_SECRET_KEY": os.getenv("APP_SECRET_KEY", "").strip(),
        "STRIPE_SECRET_KEY": os.getenv("STRIPE_SECRET_KEY", "").strip(),
        "STRIPE_WEBHOOK_SECRET": os.getenv("STRIPE_WEBHOOK_SECRET", "").strip(),
        "STRIPE_CARD_CONFIGURATION_ID": os.getenv("STRIPE_CARD_CONFIGURATION_ID", "").strip(),
        "STRIPE_PROMPTPAY_CONFIGURATION_ID": os.getenv("STRIPE_PROMPTPAY_CONFIGURATION_ID", "").strip(),
        "PAYMENT_COD_ENABLED": os.getenv("PAYMENT_COD_ENABLED", "true").lower() != "false",
        "PAYMENT_CARD_ENABLED": os.getenv("PAYMENT_CARD_ENABLED", "true").lower() != "false",
        "PAYMENT_PROMPTPAY_ENABLED": os.getenv("PAYMENT_PROMPTPAY_ENABLED", "false").lower() == "true",
        "BANK_NAME": os.getenv("BANK_NAME", "").strip(),
        "BANK_ACCOUNT_NAME": os.getenv("BANK_ACCOUNT_NAME", "").strip(),
        "BANK_ACCOUNT_NUMBER": os.getenv("BANK_ACCOUNT_NUMBER", "").strip(),
        "HEALTHCHECK_SECRET": os.getenv("HEALTHCHECK_SECRET", "").strip(),
        "MAX_CONTENT_LENGTH": 1024 * 1024,
    }


def valid_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            return None
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except ValueError:
        return None


def database_configured(config: dict) -> bool:
    return bool(valid_origin(config["SUPABASE_URL"]) and config["SUPABASE_PUBLISHABLE_KEY"])


def auth_configured(config: dict) -> bool:
    return database_configured(config) and len(config["APP_SECRET_KEY"]) >= 32 and bool(valid_origin(config["SITE_URL"]))


def commerce_configured(config: dict) -> bool:
    return auth_configured(config) and bool(config["SUPABASE_SERVICE_ROLE_KEY"])
