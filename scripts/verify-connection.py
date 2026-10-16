"""ตรวจการเชื่อมต่อจริง รับ configuration ทาง stdin ไม่เขียน credential ลงไฟล์."""

import getpass
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import create_app

print("Ready for configuration on stdin.", flush=True)
configuration = json.loads(getpass.getpass("Configuration (hidden): "))
configuration["TESTING"] = True
app = create_app(configuration)
client = app.test_client()
for path in ("/api/products", "/api/settings", "/api/auth/me", "/api/orders", "/api/admin"):
    response = client.get(path)
    payload = response.get_json()
    summary = {"path": path, "status": response.status_code}
    if "configured" in payload:
        summary["configured"] = payload["configured"]
    if "products" in payload:
        summary["product_count"] = len(payload["products"])
    if "payments" in payload:
        summary["payments"] = payload["payments"]
    print(json.dumps(summary), flush=True)
with app.app_context():
    rows, _ = app.extensions["supabase"].select(
        "products", admin=True, params={"select": "id", "limit": "20"}
    )
    print(json.dumps({"server_key_verified": True, "draft_product_count": len(rows)}), flush=True)
