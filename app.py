"""Alyzyus Flask entrypoint for local development and Vercel."""
import os
import logging

from server import create_app

app = create_app()

if __name__ == "__main__":
    # ใช้ structured logs ที่ตัด query/token ออก แทน access log ของ dev server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "3000")), debug=False)
