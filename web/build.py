"""يبني ساحة أفعى في المجلد web/dist.

الاستخدام:
    python3 build.py           بناء فقط
    python3 build.py --serve   بناء ثم تشغيل خادم محلي على http://localhost:8000
    python3 build.py --serve --port 8123

يتطلب تثبيت الحزم أولًا: npm ci
"""

import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import zipfile

WEB = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WEB)
DIST = os.path.join(WEB, "dist")
MODULES = os.path.join(WEB, "node_modules")

sys.path.insert(0, ROOT)
from afaa import __version__, vocabulary  # noqa: E402

PYODIDE_FILES = [
    "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm",
    "python_stdlib.zip", "pyodide-lock.json",
]

# نوع كل فئة من القاموس في المحرر (للتلوين والإكمال التلقائي)
CATEGORY_KINDS = {
    "KEYWORDS": "keyword",
    "SOFT_KEYWORDS": "keyword",
    "SPECIAL_NAMES": "self",
    "BUILTINS": "builtin",
    "EXCEPTIONS": "exception",
    "DUNDERS": "dunder",
    "METHODS": "method",
    "STDLIB": "library",
}
CONSTANTS = {"True", "False", "None"}


def build_vocabulary():
    categories = []
    for attr, kind in CATEGORY_KINDS.items():
        table = getattr(vocabulary, attr)
        entries = []
        for py_name, names in table.items():
            entry_kind = "constant" if py_name in CONSTANTS else kind
            entries.append({"python": py_name, "arabic": names, "kind": entry_kind})
        categories.append({"kind": kind, "entries": entries})
    return {"version": __version__, "categories": categories}


def build_examples():
    examples = []
    folder = os.path.join(ROOT, "examples")
    order = ["hello.af", "guess.af", "primes.af", "bank.af", "tour.af"]
    names = sorted(os.listdir(folder), key=lambda n: (order.index(n) if n in order else 99, n))
    for name in names:
        if not name.endswith(".af"):
            continue
        with open(os.path.join(folder, name), encoding="utf-8") as fh:
            code = fh.read()
        first = code.splitlines()[0].lstrip("#").strip() if code else name
        title = first.split(":")[0].strip()
        examples.append({"name": name, "title": title, "code": code})
    return examples


def build_package_zip(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(os.listdir(os.path.join(ROOT, "afaa"))):
            if name.endswith(".py"):
                zf.write(os.path.join(ROOT, "afaa", name), f"afaa/{name}")


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def build():
    if not os.path.isdir(MODULES):
        sys.exit("الحزم غير مثبتة: شغّل «npm ci» داخل المجلد web أولًا")
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, "pyodide"))

    esbuild = os.path.join(MODULES, ".bin", "esbuild")
    subprocess.run([
        esbuild, os.path.join(WEB, "src", "main.js"), "--bundle", "--format=esm",
        "--minify", "--sourcemap", "--target=es2022",
        f"--outfile={os.path.join(DIST, 'app.js')}",
    ], check=True)

    # الأنماط مع الخطوط (تُستضاف محليًا بدل Google Fonts)
    subprocess.run([
        esbuild, os.path.join(WEB, "src", "style.css"), "--bundle", "--minify",
        "--loader:.woff2=file", "--loader:.woff=file", "--asset-names=fonts/[name]-[hash]",
        f"--outfile={os.path.join(DIST, 'style.css')}",
    ], check=True)

    for name in ("index.html", "favicon.svg"):
        shutil.copy(os.path.join(WEB, name), DIST)
    shutil.copy(os.path.join(WEB, "src", "worker.js"), DIST)
    shutil.copy(os.path.join(MODULES, "coi-serviceworker", "coi-serviceworker.min.js"),
                os.path.join(DIST, "coi-serviceworker.js"))
    for name in PYODIDE_FILES:
        shutil.copy(os.path.join(MODULES, "pyodide", name), os.path.join(DIST, "pyodide"))

    build_package_zip(os.path.join(DIST, "afaa.zip"))
    write_json(os.path.join(DIST, "vocabulary.json"), build_vocabulary())
    write_json(os.path.join(DIST, "examples.json"), build_examples())
    # يمنع GitHub Pages من معالجة الملفات بـ Jekyll
    open(os.path.join(DIST, ".nojekyll"), "w").close()
    print(f"تم البناء في {DIST}")


class IsolatedHandler(http.server.SimpleHTTPRequestHandler):
    """خادم محلي يرسل ترويسات العزل اللازمة لـ SharedArrayBuffer."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".mjs": "text/javascript",
                      ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def serve(port):
    handler = functools.partial(IsolatedHandler, directory=DIST)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"ساحة أفعى تعمل على http://localhost:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8000
        serve(port)
