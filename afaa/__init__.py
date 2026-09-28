"""أفعى: لغة برمجة عربية مطابقة لبايثون في قواعدها.

تُترجم شيفرة أفعى إلى بايثون ثم تُنفَّذ بمفسّر بايثون نفسه، لذلك تدعم
كل خصائص بايثون ومكتباتها.

    >>> import afaa
    >>> afaa.translate("اطبع(«مرحبا»)")
    'print("مرحبا")'
"""

__version__ = "1.0.0"

from .translator import to_arabic, translate  # noqa: E402
from .runtime import compile_arabic, install, run_file, run_source  # noqa: E402

__all__ = [
    "translate", "to_arabic", "compile_arabic", "run_source", "run_file",
    "install", "__version__",
]
