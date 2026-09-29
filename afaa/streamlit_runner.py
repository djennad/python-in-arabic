"""تشغيل برامج أفعى تحت Streamlit (على الجهاز أو في المتصفح عبر stlite).

Streamlit يعيد تشغيل «السكربت الرئيسي» عند كل تفاعل. السكربت الرئيسي هنا
ملف بايثون صغير يستدعي ``run_file`` أو ``run_source``، فيُترجم برنامج أفعى
ويُنفَّذ من جديد في كل مرة، وتظهر أخطاؤه بالعربية داخل الصفحة.
"""

import os
import sys

from .errors import format_exception
from .runtime import install, run_source as _run_afaa

__all__ = ["run_source", "run_file", "launcher_source"]


def _streamlit_dir():
    import streamlit
    return os.path.dirname(os.path.abspath(streamlit.__file__))


def _show_error(exc):
    import streamlit as st
    st.error("حدث خطأ في البرنامج")
    st.code(format_exception(exc, hidden=(_streamlit_dir(),)), language=None)


def run_source(source, filename="app.af"):
    """يشغّل شيفرة أفعى داخل تشغيل Streamlit الحالي."""
    install()
    try:
        _run_afaa(source, filename, "__main__")
    except Exception as exc:  # إشارات إعادة التشغيل والإيقاف في Streamlit ليست Exception
        _show_error(exc)


def run_file(path):
    """يشغّل ملف أفعى داخل تشغيل Streamlit الحالي."""
    path = os.path.abspath(path)
    folder = os.path.dirname(path)
    if folder not in sys.path:
        sys.path.insert(0, folder)
    with open(path, "rb") as fh:
        from importlib.util import decode_source
        source = decode_source(fh.read())
    run_source(source, path)


def launcher_source(path):
    """شيفرة السكربت الرئيسي الذي يُعطى لـ streamlit run."""
    return (
        "# مولَّد تلقائيا بالأمر afaa --streamlit\n"
        "from afaa.streamlit_runner import run_file\n"
        f"run_file({os.path.abspath(path)!r})\n"
    )


def main(path, args=()):
    """afaa --streamlit ملف.af: يشغّل التطبيق بـ Streamlit على الجهاز."""
    try:
        import streamlit  # noqa: F401
    except ImportError:
        print("مكتبة Streamlit غير مثبتة. ثبّتها بالأمر:\n    pip install streamlit",
              file=sys.stderr)
        return 1
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory(prefix="afaa-streamlit-") as folder:
        launcher = os.path.join(folder, "app.py")
        with open(launcher, "w", encoding="utf-8") as fh:
            fh.write(launcher_source(path))
        command = [sys.executable, "-m", "streamlit", "run", launcher, *args]
        try:
            return subprocess.call(command)
        except KeyboardInterrupt:
            return 0
