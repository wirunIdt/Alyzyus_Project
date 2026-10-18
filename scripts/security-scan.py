"""Redacted credential-pattern scan of shareable files and optional Git history.

Never prints matching text. This is bounded pattern detection, not a guarantee that
arbitrary secrets are absent. Archived private records are excluded from publishing
by package-github.py and package-vercel.py; do not add them to any report or upload.
"""

import argparse
import base64
import importlib.util
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = {
    "supabase_secret": rb"sb_secret_[A-Za-z0-9_-]{22,}",
    "stripe_private_key": rb"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "stripe_webhook_secret": rb"whsec_[A-Za-z0-9]{20,}",
    "github_token": rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})",
    "private_key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "aws_access_id": rb"(?:AKIA|ASIA)[A-Z0-9]{16}",
}


def credential_types(content):
    findings = [name for name, pattern in PATTERNS.items() if re.search(pattern, content)]
    for token in re.findall(rb"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+", content):
        try:
            middle = token.split(b".")[1]
            claims = json.loads(base64.urlsafe_b64decode(middle + b"=" * (-len(middle) % 4)))
            if claims.get("role") == "service_role":
                findings.append("supabase_service_jwt")
        except (ValueError, TypeError):
            continue
    return sorted(set(findings))


def source_files():
    spec = importlib.util.spec_from_file_location("shareable", ROOT / "scripts/package-github.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.files()


def git_output(repository, *args):
    return subprocess.check_output(["git", "-C", str(repository), *args], timeout=60)


def scan_history(repository):
    findings = []
    scanned = 0
    for line in git_output(repository, "rev-list", "--objects", "--all").decode().splitlines():
        sha, _, path = line.partition(" ")
        if not path or git_output(repository, "cat-file", "-t", sha).strip() != b"blob":
            continue
        if int(git_output(repository, "cat-file", "-s", sha)) > 3 * 1024 * 1024:
            continue
        content = git_output(repository, "cat-file", "blob", sha)
        scanned += 1
        kinds = credential_types(content)
        if kinds:
            findings.append({"path": path, "blob": sha, "types": kinds})
    return scanned, findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, help="Existing read-only Git mirror to scan")
    args = parser.parse_args()
    files = source_files()
    findings = []
    for name, file in files.items():
        kinds = credential_types(file.read_bytes())
        if kinds:
            findings.append({"path": name, "types": kinds})
    report = {"source_files": len(files), "source_findings": findings}
    if args.history:
        count, history = scan_history(args.history.resolve(strict=True))
        report.update({"history_blobs": count, "history_findings": history})
    print(json.dumps(report, indent=2))
    if findings or report.get("history_findings"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
