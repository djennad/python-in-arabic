"""واجهة سطر الأوامر للغة أفعى.

الاستخدام:
    afaa                      الطرفية التفاعلية
    afaa ملف.af [معاملات]      تشغيل ملف
    afaa -c "شيفرة"            تشغيل شيفرة مباشرة
    afaa -m وحدة [معاملات]     تشغيل وحدة كبرنامج رئيسي
    afaa -i ملف.af             تشغيل ملف ثم فتح الطرفية
    afaa --translate ملف.af    عرض شيفرة بايثون المقابلة
    afaa --to-arabic ملف.py    تحويل ملف بايثون إلى أفعى
    afaa --web ملف.af          فتح الملف كتطبيق ويب في المتصفح (لبرامج «واجهات»)
    afaa --edit ملف.af         فتح الملف في ساحة أفعى (محرر الويب)
    afaa --vocabulary          عرض القاموس كاملًا
    afaa --version             عرض الإصدار
"""

import base64
import os
import runpy
import sys
import zlib

from . import __version__
from .errors import format_exception
from .runtime import install, run_file, run_source

USAGE = __doc__

# عنوان ساحة أفعى المنشورة (يمكن تغييره بمتغير البيئة AFAA_PLAYGROUND)
PLAYGROUND_URL = "https://djennad.github.io/python-in-arabic/"


def web_link(code, page="app.html", base=None):
    """رابط يفتح البرنامج في ساحة أفعى. الترميز مطابق لـ web/src/share.js."""
    base = base or os.environ.get("AFAA_PLAYGROUND") or PLAYGROUND_URL
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)  # deflate-raw
    data = compressor.compress(code.encode("utf-8")) + compressor.flush()
    token = "z" + base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")
    return f"{base.rstrip('/')}/{page}#code={token}"


def _read(path):
    from importlib.util import decode_source
    with open(path, "rb") as fh:
        return decode_source(fh.read())


def vocabulary_markdown():
    from . import vocabulary as v
    out = ["# قاموس لغة أفعى", "",
           "هذا الملف مولَّد تلقائيًا بالأمر `afaa --vocabulary`.", ""]
    for title, table in v.CATEGORIES:
        out += [f"## {title}", "", "| أفعى | مرادفات | بايثون |", "|---|---|---|"]
        for py_name, names in table.items():
            synonyms = "، ".join(f"`{n}`" for n in names[1:])
            out.append(f"| `{names[0]}` | {synonyms} | `{py_name}` |")
        out.append("")
    out += ["## تراكيب خاصة", "",
            "| أفعى | بايثون |", "|---|---|",
            "| `وإلا إذا` | `elif` |",
            "| `ليس في` | `not in` |",
            "| `هو ليس` | `is not` |",
            '| `"__رئيسي__"` | `"__main__"` |',
            "| `«نص»` | `\"نص\"` |",
            "| `٠١٢٣٤٥٦٧٨٩` | `0123456789` |",
            "| `٣٫١٤` | `3.14` |",
            "| `،` | `,` |",
            "| `؛` | `;` |",
            "| `٪` | `%` |", ""]
    return "\n".join(out)


def _run(action):
    try:
        action()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        sys.stderr.write("\nتمت المقاطعة.\n")
        return 130
    except BaseException as exc:  # noqa: BLE001
        sys.stderr.write(format_exception(exc))
        return 1
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    if not argv:
        from .repl import interact
        interact()
        return 0

    option = argv[0]
    if option in ("-h", "--help", "مساعدة"):
        print(USAGE)
        return 0
    if option in ("-V", "--version"):
        print(f"أفعى {__version__} (بايثون {sys.version.split()[0]})")
        return 0
    if option in ("--vocabulary", "--قاموس"):
        print(vocabulary_markdown())
        return 0
    if option in ("--web", "--edit"):
        if len(argv) < 2 or not os.path.exists(argv[1]):
            print("الاستخدام: afaa --web ملف.af  أو  afaa --edit ملف.af", file=sys.stderr)
            return 2
        url = web_link(_read(argv[1]), "app.html" if option == "--web" else "")
        print(url)
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception:  # لا متصفح متاح: يكفي طباعة الرابط
            pass
        return 0
    if option in ("--translate", "--to-arabic"):
        if len(argv) < 2:
            print(USAGE, file=sys.stderr)
            return 2
        from .translator import to_arabic, translate
        func = translate if option == "--translate" else to_arabic
        sys.stdout.write(func(_read(argv[1])))
        return 0

    install()
    interactive = False
    if option == "-i":
        interactive = True
        argv = argv[1:]
        if not argv:
            from .repl import interact
            interact()
            return 0
        option = argv[0]

    namespace = {}
    if option == "-c":
        if len(argv) < 2:
            print(USAGE, file=sys.stderr)
            return 2
        sys.argv = ["-c"] + argv[2:]
        sys.path.insert(0, "")
        status = _run(lambda: namespace.update(run_source(argv[1], "<سطر الأوامر>")))
    elif option == "-m":
        if len(argv) < 2:
            print(USAGE, file=sys.stderr)
            return 2
        sys.argv = [argv[1]] + argv[2:]
        sys.path.insert(0, os.getcwd())
        status = _run(lambda: namespace.update(
            runpy.run_module(argv[1], run_name="__main__", alter_sys=True)))
    else:
        path = option
        if not os.path.exists(path):
            print(f"أفعى: تعذّر فتح الملف '{path}': الملف غير موجود", file=sys.stderr)
            return 2
        sys.argv = argv
        sys.path.insert(0, os.path.dirname(os.path.abspath(path)))
        status = _run(lambda: namespace.update(run_file(path)))

    if interactive:
        from .repl import interact
        interact(namespace or None)
    return status


if __name__ == "__main__":
    sys.exit(main())
