"""تجميع شيفرة أفعى وتنفيذها."""

import builtins
import linecache
import os
import sys
import types

from .translator import translate

__all__ = ["compile_arabic", "run_source", "run_file", "install"]


def _register_source(filename, source):
    """يسجّل النص العربي حتى تعرض رسائل الأخطاء الأسطر الأصلية."""
    if filename.startswith("<") or not os.path.exists(filename):
        linecache.cache[filename] = (
            len(source), None, source.splitlines(True), filename)


def compile_arabic(source, filename="<أفعى>", mode="exec"):
    """يترجم شيفرة أفعى ثم يجمّعها إلى كائن شيفرة بايثون."""
    if isinstance(source, bytes):
        source = source.decode("utf-8")
    _register_source(filename, source)
    python_source = translate(source)
    try:
        return compile(python_source, filename, mode, dont_inherit=True)
    except SyntaxError as exc:
        # نعرض السطر العربي الأصلي بدل السطر المترجم
        if exc.lineno:
            lines = source.splitlines()
            if 0 < exc.lineno <= len(lines):
                exc.text = lines[exc.lineno - 1] + "\n"
                exc.offset = None
                exc.end_offset = None
        raise


def _caller_namespaces(globals_, locals_, depth=2):
    if globals_ is None:
        frame = sys._getframe(depth)
        globals_ = frame.f_globals
        if locals_ is None:
            locals_ = frame.f_locals
    elif locals_ is None:
        locals_ = globals_
    return globals_, locals_


def arabic_exec(source, globals=None, locals=None, /):
    """مثل exec لكنه يقبل شيفرة أفعى."""
    globals, locals = _caller_namespaces(globals, locals)
    if isinstance(source, (str, bytes)):
        source = compile_arabic(source, "<نفذ>", "exec")
    return exec(source, globals, locals)


def arabic_eval(source, globals=None, locals=None, /):
    """مثل eval لكنه يقبل تعبير أفعى."""
    globals, locals = _caller_namespaces(globals, locals)
    if isinstance(source, (str, bytes)):
        if isinstance(source, bytes):
            source = source.decode("utf-8")
        source = compile_arabic(source.strip(), "<قيم>", "eval")
    return eval(source, globals, locals)


_installed = False


def install():
    """يثبّت دوال أفعى الخاصة ومستورِد ملفات .af (مرة واحدة)."""
    global _installed
    if _installed:
        return
    builtins.__afaa_exec__ = arabic_exec
    builtins.__afaa_eval__ = arabic_eval
    from .importer import install_importer
    install_importer()
    _installed = True


def run_source(source, filename="<أفعى>", module_name="__main__"):
    """ينفّذ شيفرة أفعى في وحدة جديدة ويعيد قاموس متغيراتها."""
    install()
    code = compile_arabic(source, filename)
    module = types.ModuleType(module_name)
    module.__file__ = filename
    module.__builtins__ = builtins
    previous = sys.modules.get(module_name)
    sys.modules[module_name] = module
    try:
        exec(code, module.__dict__)
    finally:
        if module_name == "__main__" and previous is not None:
            sys.modules[module_name] = previous
    return module.__dict__


def run_file(path, module_name="__main__"):
    """ينفّذ ملف أفعى."""
    with open(path, "rb") as fh:
        data = fh.read()
    from importlib.util import decode_source
    return run_source(decode_source(data), os.path.abspath(path), module_name)
