"""Public portfolio demo backed only by bundled fictional products.

The demo has no login, database access, order RPC or payment endpoint. Its separate
browser module keeps all interactions in memory until reload or an explicit reset.
"""

from flask import Blueprint, render_template

from .database import sample_products

bp = Blueprint("portfolio_demo", __name__)


@bp.get("/demo")
def portfolio_demo():
    products = [
        {key: row[key] for key in ("id", "name", "category", "price", "stock", "images")}
        for row in sample_products()[:6]
    ]
    return render_template("demo.html", demo_products=products)
