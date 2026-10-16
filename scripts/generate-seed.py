"""สร้าง SQL สินค้าตัวอย่างเป็น draft โดยอ่าน JSON ไม่มี Node dependency."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def array(values):
    return "ARRAY[" + ",".join(literal(value) for value in values) + "]::text[]"


def main():
    products = json.loads((ROOT / "data/demo-products.json").read_text(encoding="utf-8"))
    rows = []
    for p in products:
        row = [
            literal(p["id"]),
            literal(p["slug"]),
            literal(json.dumps(p["name"], ensure_ascii=False)) + "::jsonb",
            literal(json.dumps(p["description"], ensure_ascii=False)) + "::jsonb",
            literal(p["category"]),
            str(p["price"]),
            str(p.get("compareAt", "NULL")),
            "0",
            array(p["images"]),
            array(p.get("colors", [])),
            "true" if p.get("featured") else "false",
            literal(p["badge"]) if p.get("badge") else "NULL",
            "false",
        ]
        rows.append("(" + ",".join(row) + ")")
    sql = (
        "-- Optional sample catalog. Inactive drafts, zero stock. Never overwrite real inventory.\ninsert into public.products(id,slug,name,description,category,price,compare_at,stock,images,colors,featured,badge,active) values\n"
        + ",\n".join(rows)
        + "\non conflict(id) do nothing;\n"
    )
    (ROOT / "supabase/seed.sql").write_text(sql, encoding="utf-8")
    print(f"Generated {len(rows)} draft products")


if __name__ == "__main__":
    main()
