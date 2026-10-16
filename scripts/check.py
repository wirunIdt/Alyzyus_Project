"""Run the same bounded, secret-free quality checks locally and in CI.

Usage: python scripts/check.py [--fix] [--fast]
Tools are development dependencies; this script never contacts production data.
"""

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON_TARGETS = ["app.py", "server", "scripts", "tests"]
PRETTIER_TARGETS = [
    "public/static/js/*.js",
    "public/static/css/*.css",
    "public/sw.js",
    "public/static/queue3d.html",
    "public/offline.html",
    "tests/*.mjs",
    "tests/package.json",
    ".prettierrc.json",
]


class InlineScripts(HTMLParser):
    """Extract executable inline JavaScript from the standalone 3D file."""

    def __init__(self):
        super().__init__()
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and "src" not in attributes:
            script_type = attributes.get("type", "text/javascript")
            if script_type in ("text/javascript", "application/javascript", "module"):
                self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.scripts.append("".join(self.current))
            self.current = None


def run(label, command, *, input_text=None, quiet=False, timeout=180):
    print(f"\n{label}", flush=True)
    environment = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=environment,
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=quiet,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        if quiet:
            print(result.stdout or "", end="")
            print(result.stderr or "", end="", file=sys.stderr)
        raise SystemExit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix", action="store_true", help="Apply safe lint fixes and formatting first"
    )
    parser.add_argument(
        "--fast", action="store_true", help="Skip full Python and database/UI suites"
    )
    options = parser.parse_args()
    node = shutil.which("node")
    prettier = ROOT / "tests/node_modules/prettier/bin/prettier.cjs"
    if not node or not prettier.is_file():
        parser.exit(2, "Install Node.js, then run: npm --prefix tests ci --ignore-scripts\n")
    if importlib.util.find_spec("ruff") is None:
        parser.exit(
            2, "Install Python development tools: python -m pip install -r requirements-dev.txt\n"
        )

    python = sys.executable
    ruff = [python, "-m", "ruff"]
    if options.fix:
        run("Apply safe Python lint fixes", [*ruff, "check", "--fix", *PYTHON_TARGETS])
        run("Format Python", [*ruff, "format", *PYTHON_TARGETS])
        run("Format browser source", [node, str(prettier), "--write", *PRETTIER_TARGETS])

    run("Python lint", [*ruff, "check", *PYTHON_TARGETS])
    run("Python format", [*ruff, "format", "--check", *PYTHON_TARGETS])
    run("Browser format", [node, str(prettier), "--check", *PRETTIER_TARGETS])
    browser_files = [*sorted((ROOT / "public/static/js").glob("*.js")), ROOT / "public/sw.js"]
    for file in browser_files:
        run(f"JavaScript syntax: {file.relative_to(ROOT)}", [node, "--check", str(file)])
    inline = InlineScripts()
    inline.feed((ROOT / "public/static/queue3d.html").read_text(encoding="utf-8"))
    if not inline.scripts:
        raise SystemExit("Standalone 3D file must contain executable JavaScript")
    for index, source in enumerate(inline.scripts, 1):
        run(f"Standalone 3D syntax: script {index}", [node, "--check"], input_text=source)

    run(
        "Compile every Jinja template",
        [
            python,
            "-c",
            "from server import create_app; "
            "app = create_app({'TESTING': True}); "
            "[app.jinja_env.get_template(name) for name in app.jinja_env.list_templates()]",
        ],
    )
    run(
        "Shareable source allowlist and credential scan",
        [python, "scripts/package-github.py"],
        quiet=True,
    )
    run("Deployment file allowlist", [python, "scripts/package-vercel.py"], quiet=True)
    if not options.fast:
        run(
            "Python behavior and authorization",
            [python, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
        )
        test_files = [str(file) for file in sorted((ROOT / "tests").glob("*.test.mjs"))]
        run("Database transactions and browser lifecycle", [node, "--test", *test_files])
    print("\nAll requested checks passed.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.TimeoutExpired as error:
        raise SystemExit("Quality check timed out; inspect the last step above.") from error
