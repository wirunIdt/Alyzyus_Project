"""HTML pages share a public catalog bootstrap and never expose account credentials."""
import re
from urllib.parse import urlencode

from flask import Blueprint, abort, redirect, render_template, request, send_from_directory

from .database import catalog
from .config import ROOT

bp = Blueprint("pages", __name__)


def page(template, **values):
    return render_template(template, bootstrap=catalog(), **values)


@bp.get("/")
def index():
    return page("index.html")


@bp.get("/shop")
def shop():
    return page("shop.html")


@bp.get("/product/<slug>")
def product(slug):
    bootstrap = catalog()
    product = next((item for item in bootstrap["products"] if item["slug"] == slug), None)
    if not product:
        abort(404)
    return render_template("product.html", bootstrap=bootstrap, product=product)


@bp.get("/admin")
def admin():
    return page("admin.html")


@bp.get("/admin/logs")
def activity_logs():
    # ข้อมูลกิจกรรมโหลดผ่าน API ที่ตรวจสิทธิ์ผู้ดูแลอีกครั้ง
    return page("logs.html")


@bp.get("/support")
def support():
    return page("support.html", admin_mode=False)


@bp.get("/admin/support")
def support_inbox():
    # หน้า HTML ไม่มีเนื้อหาคำร้อง ข้อมูลโหลดผ่าน API ที่ตรวจสิทธิ์ Admin เท่านั้น
    return page("support.html", admin_mode=True)


@bp.get("/install")
def install():
    return page("install.html")


@bp.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(ROOT / "public", "manifest.webmanifest", mimetype="application/manifest+json")


@bp.get("/sw.js")
def service_worker():
    response = send_from_directory(ROOT / "public", "sw.js", mimetype="application/javascript", max_age=0)
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@bp.get("/offline.html")
def offline():
    return send_from_directory(ROOT / "public", "offline.html")


@bp.get("/checkout")
def checkout():
    return page("checkout.html")


@bp.get("/account")
def account():
    return page("account.html")


@bp.get("/tracking")
def tracking():
    return page("tracking.html")


@bp.get("/help")
def help_page():
    return page("help.html", policies=False)


@bp.get("/policies")
def policies():
    return page("help.html", policies=True)


@bp.get("/simulation")
@bp.get("/queue3d")
def simulation():
    params = {}
    mode = request.args.get("mode")
    if mode in ("product", "office", "demo", "live"):
        params["mode"] = mode if mode in ("product", "office") else "product"
    locale = request.args.get("locale")
    if locale in ("th", "en", "zh"):
        params["locale"] = locale
    for key in ("order", "product"):
        value = request.args.get(key, "")
        uuid = re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value)
        if uuid or (key == "order" and re.fullmatch(r"ALY-\d{4}-\d{1,20}", value)):
            params[key] = value
    return redirect("/static/queue3d.html" + ("?" + urlencode(params) if params else ""), code=307)
