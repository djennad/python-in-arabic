"""مكان حفظ البيانات: ملفات على الجهاز، أو ذاكرة المتصفح الدائمة.

في المتصفح (Pyodide) يربط عامل الخلفية المجلد /data بقاعدة IndexedDB في
المتصفح، ويضبط ``set_persist_hook`` بدالة تحفظ التغييرات. لذلك تبقى البيانات
بعد إغلاق الصفحة، وهي خاصة بكل زائر وكل موقع.
"""

import os
import sys

IN_BROWSER = sys.platform == "emscripten"
DATA_DIR = "/data"
MEMORY = (None, "", ":memory:", ":ذاكرة:")

_persist_hook = None


def set_persist_hook(func):
    global _persist_hook
    _persist_hook = func


def persist():
    """يحفظ التغييرات في ذاكرة المتصفح الدائمة (لا يفعل شيئا على الجهاز)."""
    if _persist_hook is not None:
        _persist_hook()


def resolve(name):
    """يحوّل اسم قاعدة البيانات إلى مسار ملف. «مدرستي» ← مدرستي.db"""
    if name in MEMORY:
        return ":memory:"
    path = os.fspath(name)
    if not os.path.splitext(path)[1]:
        path += ".db"
    if IN_BROWSER and not os.path.isabs(path):
        path = os.path.join(DATA_DIR, path)
    return path
