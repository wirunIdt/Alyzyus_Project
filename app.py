"""Alyzyus Flask entrypoint for local development and Vercel."""
import os

from server import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "3000")), debug=False)
