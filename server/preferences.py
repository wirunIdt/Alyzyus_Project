"""Member-only appearance permission, verified from the current Auth session.

Appearance values and photos stay in account-scoped storage on the device.
This endpoint deliberately accepts no browser-supplied identity or permission.
"""
from flask import Blueprint, jsonify

from .auth import require_user

bp = Blueprint("appearance", __name__)


@bp.get("/api/account/appearance")
def appearance_permission():
    user = require_user()
    return jsonify(allowed=True, userId=user["id"])
