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
from streamlit_build import build_streamlit_runtime  # noqa: E402

CACHE = os.path.join(WEB, ".cache")

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


EXAMPLE_ORDER = ["hello.af", "guess.af", "primes.af", "bank.af", "database.af", "orm.af", "tour.af",
                 "counter.af", "calculator.af", "todo.af", "students.af", "notes.af", "dashboard.af",
                 "appointments.af", "csv.af", "snake.af", "paint.af", "drawing.af", "clock.af", "chat.af"]
EXAMPLE_GROUPS = [("", "أمثلة اللغة"), ("gui", "تطبيقات الواجهات"),
                  ("streamlit", "مواقع ستريمليت")]


def build_examples():
    examples = []
    for subfolder, group in EXAMPLE_GROUPS:
        folder = os.path.join(ROOT, "examples", subfolder)
        names = sorted((n for n in os.listdir(folder) if n.endswith(".af")),
                       key=lambda n: (EXAMPLE_ORDER.index(n) if n in EXAMPLE_ORDER else 99, n))
        for name in names:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                code = fh.read()
            first = code.splitlines()[0].lstrip("#").strip() if code else name
            title = first.split(":")[0].strip()
            key = f"{subfolder}/{name}" if subfolder else name
            examples.append({"name": key, "title": title, "group": group, "code": code})
    return examples


def build_package_zip(path):
    """حزمة afaa للمتصفح: ملفات بايثون ومكتبات أفعى (lib/*.af)."""
    package = os.path.join(ROOT, "afaa")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, _dirs, files in os.walk(package):
            for name in sorted(files):
                if name.endswith((".py", ".af")):
                    full = os.path.join(folder, name)
                    zf.write(full, os.path.relpath(full, ROOT))


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def _folder_files(folder):
    files = []
    for current, _dirs, names in os.walk(os.path.join(DIST, folder)):
        for name in sorted(names):
            if not name.endswith(".map"):
                path = os.path.relpath(os.path.join(current, name), DIST).replace(os.sep, "/")
                files.append({"from": path, "to": path})
    return files


def standalone_manifest(kind="app"):
    """الملفات التي يحتاجها تطبيق مستقل مُصدَّر (يستخدمها زر «تصدير كموقع»).

    kind: «app» لتطبيقات «واجهات» والبرامج العادية، و«streamlit» لتطبيقات ستريمليت.
    """
    if kind == "streamlit":
        files = [{"from": "streamlit.html", "to": "index.html"}]
        names = ("streamlit-app.js", "streamlit.css", "coi-serviceworker.js", "favicon.svg", "afaa.zip")
        folders = ("chunks", "fonts", "streamlit")
    else:
        files = [{"from": "app.html", "to": "index.html"}]
        names = ("app.js", "app.css", "worker.js", "coi-serviceworker.js", "favicon.svg", "afaa.zip")
        folders = ("chunks", "fonts", "pyodide")
    files += [{"from": name, "to": name} for name in names]
    for folder in folders:
        files += _folder_files(folder)
    return files


def build():
    if not os.path.isdir(MODULES):
        sys.exit("الحزم غير مثبتة: شغّل «npm ci» داخل المجلد web أولًا")
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, "pyodide"))
    os.makedirs(os.path.join(DIST, "chunks"))

    esbuild = os.path.join(MODULES, ".bin", "esbuild")
    # main.js: المحرر، app.js: التطبيق المستقل. الأجزاء المشتركة في chunks/
    subprocess.run([
        esbuild, os.path.join(WEB, "src", "main.js"), os.path.join(WEB, "src", "app.js"),
        os.path.join(WEB, "src", "streamlit-app.js"),
        "--bundle", "--format=esm", "--splitting", "--minify", "--sourcemap",
        "--target=es2022", f"--outdir={DIST}", "--entry-names=[name]",
        "--chunk-names=chunks/[name]-[hash]",
    ], check=True)

    # الأنماط مع الخطوط (تُستضاف محليًا بدل Google Fonts)
    for name in ("style.css", "app.css", "streamlit.css"):
        subprocess.run([
            esbuild, os.path.join(WEB, "src", name), "--bundle", "--minify",
            "--loader:.woff2=file", "--loader:.woff=file", "--asset-names=fonts/[name]-[hash]",
            f"--outfile={os.path.join(DIST, name)}",
        ], check=True)

    for name in ("index.html", "app.html", "streamlit.html", "favicon.svg"):
        shutil.copy(os.path.join(WEB, name), DIST)
    shutil.copy(os.path.join(WEB, "src", "worker.js"), DIST)
    shutil.copy(os.path.join(MODULES, "coi-serviceworker", "coi-serviceworker.min.js"),
                os.path.join(DIST, "coi-serviceworker.js"))
    for name in PYODIDE_FILES:
        shutil.copy(os.path.join(MODULES, "pyodide", name), os.path.join(DIST, "pyodide"))

    build_package_zip(os.path.join(DIST, "afaa.zip"))
    write_json(os.path.join(DIST, "vocabulary.json"), build_vocabulary())
    write_json(os.path.join(DIST, "examples.json"), build_examples())
    # ستريمليت في المتصفح (stlite) مع Pyodide 0.29.3 مصغّر
    build_streamlit_runtime(DIST, MODULES, CACHE)
    write_json(os.path.join(DIST, "standalone.json"), standalone_manifest())
    write_json(os.path.join(DIST, "standalone-streamlit.json"), standalone_manifest("streamlit"))
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
