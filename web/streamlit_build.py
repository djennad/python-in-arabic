"""تجهيز بيئة Streamlit للمتصفح (stlite) مستضافة مع الموقع نفسه.

stlite يشغّل Streamlit داخل المتصفح على Pyodide 0.29.3، وهو إصدار غير الذي
يستخدمه المحرر. لا ننشر توزيعة Pyodide كاملة (أكثر من ٤٠٠ ميغابايت)، بل:

1. ننزّل توزيعة Pyodide 0.29.3 مرة واحدة إلى web/.cache (من إصدارات GitHub).
2. نستخرج منها النواة والحزم التي يحتاجها Streamlit فقط (مع اعتمادياتها).
3. نضيف حزما بايثونية خالصة ناقصة أو قديمة في التوزيعة (من PyPI، بإصدارات
   وبصمات ثابتة)، ونسجلها في pyodide-lock.json، فلا يتصل الموقع بـ PyPI أبدا.
"""

import hashlib
import json
import os
import re
import shutil
import tarfile
import urllib.request

PYODIDE_VERSION = "0.29.3"
PYODIDE_URL = (f"https://github.com/pyodide/pyodide/releases/download/"
               f"{PYODIDE_VERSION}/pyodide-{PYODIDE_VERSION}.tar.bz2")
CORE_FILES = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip"]

# الحزم التي يستوردها Streamlit في stlite (وتُضاف اعتمادياتها تلقائيا)
ROOT_PACKAGES = [
    "micropip", "pyodide-http", "pillow", "altair", "typing-extensions", "packaging",
    "numpy", "pandas", "starlette", "anyio", "fastparquet",
]

# حزم بايثونية خالصة غير موجودة في التوزيعة أو إصدارها فيها أقدم مما يحتاجه Streamlit
EXTRA_WHEELS = {
    "protobuf": ("7.36.2", ["google"]),
    "blinker": ("1.9.0", ["blinker"]),
    "itsdangerous": ("2.2.0", ["itsdangerous"]),
    "python-multipart": ("0.0.32", ["python_multipart", "multipart"]),
    "toml": ("0.10.2", ["toml"]),   # يستخدمه Streamlit لقراءة إعدادات المكوّنات
}


def _download(url, path):
    tmp = path + ".part"
    print(f"تنزيل {url}")
    with urllib.request.urlopen(url) as response, open(tmp, "wb") as fh:
        shutil.copyfileobj(response, fh)
    os.replace(tmp, path)


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _normal(name):
    """اسم الحزمة الموحّد (PEP 503): الاعتماديات تكتب jsonschema_specifications
    بينما مفتاح الحزمة في ملف القفل jsonschema-specifications."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _closure(packages, roots):
    """الحزم المطلوبة مع كل اعتمادياتها حسب ملف القفل."""
    by_name = {_normal(key): key for key in packages}
    needed, stack = set(), list(roots)
    while stack:
        key = by_name.get(_normal(stack.pop()))
        if key is None or key in needed:
            continue
        needed.add(key)
        stack.extend(packages[key].get("depends", []))
    return needed


def _pyodide_subset(cache):
    """يعيد مجلدا فيه نواة Pyodide والحزم المطلوبة (مستخرجة من التوزيعة مرة واحدة)."""
    target = os.path.join(cache, f"pyodide-{PYODIDE_VERSION}-streamlit")
    marker = os.path.join(target, ".complete")
    if os.path.exists(marker):
        return target
    archive = os.path.join(cache, f"pyodide-{PYODIDE_VERSION}.tar.bz2")
    if not os.path.exists(archive):
        _download(PYODIDE_URL, archive)
    print("استخراج الحزم المطلوبة من توزيعة Pyodide…")
    os.makedirs(target, exist_ok=True)
    with tarfile.open(archive, "r:bz2") as tar:
        lock_member = tar.getmember("pyodide/pyodide-lock.json")
        lock = json.load(tar.extractfile(lock_member))
        packages = lock["packages"]
        wanted = set(CORE_FILES) | {"pyodide-lock.json"}
        wanted |= {packages[n]["file_name"] for n in _closure(packages, ROOT_PACKAGES)}
        for member in tar:
            name = member.name.split("/", 1)[-1]
            if member.isfile() and name in wanted:
                with tar.extractfile(member) as src, open(os.path.join(target, name), "wb") as dst:
                    shutil.copyfileobj(src, dst)
    open(marker, "w").close()
    return target


def _extra_wheel(cache, name, version):
    """ينزّل حزمة بايثونية خالصة من PyPI ويتحقق من بصمتها المنشورة."""
    folder = os.path.join(cache, "wheels")
    os.makedirs(folder, exist_ok=True)
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json") as response:
        info = json.load(response)
    wheel = next(u for u in info["urls"] if u["packagetype"] == "bdist_wheel"
                 and re.search(r"-(py2\.)?py3-none-any\.whl$", u["filename"]))
    path = os.path.join(folder, wheel["filename"])
    if not os.path.exists(path) or _sha256(path) != wheel["digests"]["sha256"]:
        _download(wheel["url"], path)
    if _sha256(path) != wheel["digests"]["sha256"]:
        raise RuntimeError(f"بصمة الحزمة {wheel['filename']} لا تطابق PyPI")
    return path


def build_streamlit_runtime(dist, modules, cache):
    """ينسخ stlite وPyodide المصغّر إلى dist/streamlit ويعيد أسماء ملفاته."""
    out = os.path.join(dist, "streamlit")
    pyodide_out = os.path.join(out, "pyodide")
    os.makedirs(pyodide_out, exist_ok=True)

    subset = _pyodide_subset(cache)
    with open(os.path.join(subset, "pyodide-lock.json"), encoding="utf-8") as fh:
        lock = json.load(fh)
    for name in os.listdir(subset):
        if name not in (".complete", "pyodide-lock.json"):
            shutil.copy(os.path.join(subset, name), pyodide_out)

    for name, (version, imports) in EXTRA_WHEELS.items():
        wheel = _extra_wheel(cache, name, version)
        shutil.copy(wheel, pyodide_out)
        lock["packages"][name] = {
            "name": name, "version": version, "file_name": os.path.basename(wheel),
            "install_dir": "site", "sha256": _sha256(wheel), "package_type": "package",
            "imports": imports, "depends": [], "unvendored_tests": False,
        }
    # نبقي في ملف القفل الحزم المتوفرة فقط، فيظهر خطأ واضح بدل طلب ملف غير موجود
    present = set(os.listdir(pyodide_out))
    lock["packages"] = {n: p for n, p in lock["packages"].items() if p["file_name"] in present}
    with open(os.path.join(pyodide_out, "pyodide-lock.json"), "w", encoding="utf-8") as fh:
        json.dump(lock, fh)

    stlite = os.path.join(modules, "@stlite", "browser", "build")
    shutil.copytree(stlite, os.path.join(out, "stlite"),
                    ignore=shutil.ignore_patterns("*.map", "*.d.ts"))
    return out
