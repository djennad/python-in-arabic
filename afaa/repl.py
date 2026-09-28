"""الطرفية التفاعلية للغة أفعى."""

import code
import sys

from . import __version__
from .errors import format_exception, format_exception_only
from .runtime import _register_source, install
from .translator import translate

BANNER = (
    f"أفعى {__version__} — لغة برمجة عربية مبنية على بايثون "
    f"{sys.version.split()[0]}\n"
    "اكتب «اخرج()» للخروج، و«مساعدة()» للمساعدة."
)


class ArabicConsole(code.InteractiveConsole):
    def __init__(self, locals=None):
        super().__init__(locals=locals, filename="<الطرفية>")
        self._counter = 0

    def runsource(self, source, filename="<الطرفية>", symbol="single"):
        self._counter += 1
        filename = f"<الطرفية-{self._counter}>"
        _register_source(filename, source)
        try:
            python_source = translate(source)
        except Exception:
            python_source = source
        return super().runsource(python_source, filename, symbol)

    def showsyntaxerror(self, filename=None, **kwargs):
        exc = sys.exc_info()[1]
        self.write(format_exception_only(exc))

    def showtraceback(self):
        exc = sys.exc_info()[1]
        # نتخطى إطار الطرفية نفسها
        tb = exc.__traceback__
        if tb is not None and tb.tb_next is not None:
            exc = exc.with_traceback(tb.tb_next)
        self.write(format_exception(exc))


def interact(namespace=None):
    install()
    if namespace is None:
        namespace = {"__name__": "__main__", "__doc__": None}
    try:
        import readline  # noqa: F401  (تحرير الأسطر والسجل إن توفر)
    except ImportError:
        pass
    ArabicConsole(namespace).interact(banner=BANNER, exitmsg="مع السلامة!")
