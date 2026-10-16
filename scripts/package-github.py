"""Allowlist shareable source, never credentials or archived customer records."""

import base64
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = (
    ".env.example",
    ".gitignore",
    ".vercelignore",
    ".editorconfig",
    ".prettierrc.json",
    ".prettierignore",
    "ruff.toml",
    "requirements-dev.txt",
    "README.md",
    "CODE_GUIDE.md",
    "ASSETS.md",
)
SOURCE_PATTERNS = (
    ("scripts", "*.py"),
    ("tests", "*.py"),
    ("tests", "*.mjs"),
    ("tests", "package*.json"),
    ("supabase", "*.md"),
    ("supabase", "*.sql"),
    ("supabase/migrations", "*.sql"),
    ("docs", "*.md"),
    (".github/workflows", "*.yml"),
)


def files():
    """Keep development files separate from the smaller production allowlist."""
    spec = importlib.util.spec_from_file_location(
        "deployment_package", ROOT / "scripts/package-vercel.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    allowed = module.files()
    allowed.update({name: ROOT / name for name in ROOT_FILES})
    for folder, pattern in SOURCE_PATTERNS:
        for file in (ROOT / folder).glob(pattern):
            allowed[file.relative_to(ROOT).as_posix()] = file
    artifacts = {
        "portfolio": (
            "artifacts/university/output",
            ("Alyzyus_Introduction.pdf", "Alyzyus_Presentation.pdf", "Alyzyus_Portfolio.pptx"),
        ),
        "docs/screenshots": (
            "artifacts/screenshots",
            ("storefront.jpg", "product-journey.jpg", "queue-office.jpg"),
        ),
    }
    for destination, (folder, names) in artifacts.items():
        for name in names:
            file = ROOT / folder / name
            if file.is_file():
                allowed[f"{destination}/{name}"] = file
    return allowed


def manifest_item(name, file):
    content = file.read_bytes()
    binary = file.suffix.lower() in (".jpg", ".png", ".webp", ".pptx", ".pdf")
    if not binary and re.search(
        rb"(?:sb_secret_|sb_publishable_)[A-Za-z0-9_\-]{22,}|sk_live_[A-Za-z0-9]{15,}", content
    ):
        raise SystemExit("Refusing credential-like content in " + name)
    sha = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
    return {"path": name, "size": len(content), "binary": binary, "gitSha": sha}


def main():
    allowed = files()
    if len(sys.argv) == 1:
        print(json.dumps([manifest_item(name, file) for name, file in sorted(allowed.items())]))
        return
    name = sys.argv[1]
    if name not in allowed:
        raise SystemExit("File is not allowlisted")
    item = manifest_item(name, allowed[name])
    content = allowed[name].read_bytes()
    if item["binary"]:
        offset = int(sys.argv[2]) if len(sys.argv) > 2 else 0
        # Multiples of three let the connector concatenate base64 chunks safely.
        item["data"] = base64.b64encode(content[offset : offset + 32766]).decode("ascii")
    else:
        item["content"] = content.decode("utf-8")
    print(json.dumps(item, ensure_ascii=False))


if __name__ == "__main__":
    main()
