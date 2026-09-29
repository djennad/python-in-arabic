"""عرض رسائل الأخطاء وتتبع الاستدعاءات باللغة العربية."""

import os
import re
import traceback

from . import vocabulary as _v

__all__ = ["format_exception", "format_exception_only", "arabize_message"]

_PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))

_EXCEPTION_NAMES = {py: names[0] for py, names in _v.EXCEPTIONS.items()}

# أسماء بايثون التي نعرضها بالعربية داخل رسائل الأخطاء
_TYPE_NAMES = dict(_v.PYTHON_TO_ARABIC)
_TYPE_NAMES["NoneType"] = "نوع_لاشيء"
_TYPE_NAMES["function"] = "دالة"
_TYPE_NAMES["module"] = "وحدة"
_TYPE_NAMES["method"] = "طريقة"
_TYPE_NAMES["builtin_function_or_method"] = "دالة_مدمجة"
_TYPE_NAMES["generator"] = "مولد"
_TYPE_NAMES["coroutine"] = "روتين_مشترك"

_MESSAGES = [
    (r"name '(.+?)' is not defined(?:\. Did you mean: '(.+?)'\?)?",
     lambda m: f"الاسم '{m[1]}' غير معرّف"
     + (f"، هل تقصد: '{m[2]}'؟" if m[2] else "")),
    (r"cannot access local variable '(.+?)' where it is not associated with a value",
     r"لا يمكن الوصول إلى المتغير المحلي '\1' قبل إسناد قيمة له"),
    (r"local variable '(.+?)' referenced before assignment",
     r"استُخدم المتغير المحلي '\1' قبل إسناد قيمة له"),
    (r"(?:integer |float )?division(?: or modulo)? by zero", "القسمة على صفر"),
    (r"integer modulo by zero", "باقي القسمة على صفر"),
    (r"(\w+) index out of range", lambda m: f"الفهرس خارج نطاق {_name(m[1])}"),
    (r"(\w+) assignment index out of range",
     lambda m: f"فهرس الإسناد خارج نطاق {_name(m[1])}"),
    (r"pop from empty (\w+)", lambda m: f"النزع من {_name(m[1])} فارغة"),
    (r"pop index out of range", "فهرس النزع خارج النطاق"),
    (r"unsupported operand type\(s\) for (.+?): '(.+?)' and '(.+?)'",
     lambda m: f"العملية {m[1]} غير مدعومة بين '{_name(m[2])}' و '{_name(m[3])}'"),
    (r"bad operand type for (.+?): '(.+?)'",
     lambda m: f"نوع غير مناسب للعملية {m[1]}: '{_name(m[2])}'"),
    (r"'(.+?)' not supported between instances of '(.+?)' and '(.+?)'",
     lambda m: f"المقارنة '{m[1]}' غير مدعومة بين '{_name(m[2])}' و '{_name(m[3])}'"),
    (r'can only concatenate (\w+) \(not "(\w+)"\) to (\w+)',
     lambda m: f"يمكن دمج {_name(m[1])} مع {_name(m[3])} فقط (وليس مع {_name(m[2])})"),
    (r"invalid literal for int\(\) with base (\d+): (.+)",
     lambda m: f"قيمة غير صالحة للتحويل إلى عدد_صحيح بالأساس {m[1]}: {m[2]}"),
    (r"could not convert string to float: (.+)",
     r"تعذّر تحويل النص إلى عدد_عشري: \1"),
    (r"'(.+?)' object is not callable",
     lambda m: f"الكائن من نوع '{_name(m[1])}' غير قابل للاستدعاء"),
    (r"'(.+?)' object is not subscriptable",
     lambda m: f"الكائن من نوع '{_name(m[1])}' لا يقبل الفهرسة"),
    (r"'(.+?)' object is not iterable",
     lambda m: f"الكائن من نوع '{_name(m[1])}' غير قابل للتكرار"),
    (r"'(.+?)' object does not support item assignment",
     lambda m: f"الكائن من نوع '{_name(m[1])}' لا يدعم إسناد العناصر"),
    (r"object of type '(.+?)' has no len\(\)",
     lambda m: f"الكائن من نوع '{_name(m[1])}' ليس له طول"),
    (r"'(.+?)' object has no attribute '(.+?)'(?:\. Did you mean: '(.+?)'\?)?",
     lambda m: f"الكائن من نوع '{_name(m[1])}' ليس له الخاصية '{_name(m[2])}'"
     + (f"، هل تقصد: '{_name(m[3])}'؟" if m[3] else "")),
    (r"module '(.+?)' has no attribute '(.+?)'(?:\. Did you mean: '(.+?)'\?)?",
     lambda m: f"الوحدة '{_name(m[1])}' ليس لها الخاصية '{_name(m[2])}'"
     + (f"، هل تقصد: '{_name(m[3])}'؟" if m[3] else "")),
    (r"(\S+?)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given",
     lambda m: f"الدالة {_name(m[1])}() تأخذ {m[2]} معطيات موضعية لكن أُعطيت {m[3]}"),
    (r"(\S+?)\(\) takes exactly one argument \((\d+) given\)",
     lambda m: f"الدالة {_name(m[1])}() تأخذ معطى واحدًا فقط (أُعطيت {m[2]})"),
    (r"(\S+?)\(\) takes no arguments \((\d+) given\)",
     lambda m: f"الدالة {_name(m[1])}() لا تأخذ معطيات (أُعطيت {m[2]})"),
    (r"(\S+?)\(\) missing (\d+) required positional arguments?: (.+)",
     lambda m: f"الدالة {_name(m[1])}() ينقصها {m[2]} من المعطيات المطلوبة: "
     + m[3].replace(" and ", " و ")),
    (r"(\S+?)\(\) got an unexpected keyword argument '(.+?)'",
     lambda m: f"الدالة {_name(m[1])}() تلقت معطى مسمى غير متوقع '{_name(m[2])}'"),
    (r"No module named '(.+?)'", lambda m: f"لا توجد وحدة باسم '{_name(m[1])}'"),
    (r"maximum recursion depth exceeded(.*)",
     r"تم تجاوز الحد الأقصى لعمق الاستدعاء الذاتي\1"),
    (r"math domain error", "قيمة خارج مجال الدالة الرياضية"),
    (r"dictionary changed size during iteration", "تغيّر حجم القاموس أثناء التكرار"),
    (r"list\.remove\(x\): x not in list", "العنصر غير موجود في القائمة"),
    (r"(.+?) is not in list", r"\1 غير موجود في القائمة"),
    (r"substring not found", "النص الفرعي غير موجود"),
    (r"too many values to unpack \(expected (\d+)(?:, got (\d+))?\)",
     lambda m: f"قيم كثيرة جدًا للتفكيك (المتوقع {m[1]}"
     + (f"، الموجود {m[2]}" if m[2] else "") + ")"),
    (r"not enough values to unpack \(expected (\d+), got (\d+)\)",
     r"قيم غير كافية للتفكيك (المتوقع \1، الموجود \2)"),
    (r"No such file or directory", "لا يوجد ملف أو مجلد بهذا الاسم"),
    (r"invalid syntax\. Perhaps you forgot a comma\?", "صياغة غير صالحة، هل نسيت فاصلة؟"),
    (r"invalid syntax\. Maybe you meant '==' or ':=' instead of '='\?",
     "صياغة غير صالحة، هل تقصد '==' بدل '='؟"),
    (r"invalid syntax", "صياغة غير صالحة"),
    (r"expected ':'", "متوقع ':'"),
    (r"expected an indented block after (.+?) on line (\d+)",
     r"متوقع كتلة مُزاحة بعد \1 في السطر \2"),
    (r"expected an indented block", "متوقع كتلة مُزاحة"),
    (r"unexpected indent", "إزاحة غير متوقعة"),
    (r"unindent does not match any outer indentation level",
     "الإزاحة لا تطابق أي مستوى إزاحة خارجي"),
    (r"unterminated string literal \(detected at line (\d+)\)",
     r"نص غير مغلق (اكتُشف في السطر \1)"),
    (r"unterminated triple-quoted string literal \(detected at line (\d+)\)",
     r"نص ثلاثي علامات الاقتباس غير مغلق (اكتُشف في السطر \1)"),
    (r"'(.)' was never closed", r"القوس '\1' لم يُغلق"),
    (r"unmatched '(.)'", r"القوس '\1' غير مطابق"),
    (r"invalid character '(.)' \((.+?)\)", r"حرف غير صالح '\1' (\2)"),
    (r"'return' outside function", "«أرجع» خارج دالة"),
    (r"'break' outside loop", "«اكسر» خارج حلقة"),
    (r"'continue' not properly in loop", "«استمر» خارج حلقة"),
    (r"'await' outside (?:async )?function", "«انتظر» خارج دالة غير متزامنة"),
]
_MESSAGES = [(re.compile(p), r) for p, r in _MESSAGES]


def _name(py_name):
    return ".".join(_TYPE_NAMES.get(part, part) for part in py_name.split("."))


_LEADING_EXC = re.compile(r"^([A-Za-z_][\w.]*)(?=: |$)")


def arabize_message(line, exc_type_name=None):
    """يترجم سطر «نوع_الخطأ: الرسالة» إلى العربية."""
    head, sep, message = line.partition(": ")
    head = _LEADING_EXC.sub(lambda m: _EXCEPTION_NAMES.get(m[1], m[1]), head)
    if not sep:
        return head
    if exc_type_name not in ("KeyError",):
        for pattern, replacement in _MESSAGES:
            new, count = pattern.subn(replacement, message, count=1)
            if count:
                message = new
                break
    return head + sep + message


_HEADERS = [
    ("Traceback (most recent call last):",
     "تتبع الاستدعاءات (الاستدعاء الأخير في النهاية):"),
    ("During handling of the above exception, another exception occurred:",
     "أثناء معالجة الاستثناء السابق حدث استثناء آخر:"),
    ("The above exception was the direct cause of the following exception:",
     "الاستثناء السابق هو السبب المباشر للاستثناء التالي:"),
]
_FRAME = re.compile(r'^(\s*)File "(.+)", line (\d+), in (.+)$')
_SYNTAX_FRAME = re.compile(r'^(\s*)File "(.+)", line (\d+)$')


def _arabize_lines(text, exc_type_name):
    result = []
    for line in text.splitlines():
        stripped = line.strip()
        replaced = False
        for english, arabic in _HEADERS:
            if stripped == english:
                result.append(line.replace(english, arabic))
                replaced = True
                break
        if replaced:
            continue
        m = _FRAME.match(line)
        if m:
            where = {"<module>": "<الوحدة>", "<lambda>": "<لامدا>"}.get(
                m[4], _name(m[4]))
            result.append(f'{m[1]}الملف "{m[2]}"، السطر {m[3]}، في {where}')
            continue
        m = _SYNTAX_FRAME.match(line)
        if m:
            result.append(f'{m[1]}الملف "{m[2]}"، السطر {m[3]}')
            continue
        m = _LEADING_EXC.match(line)
        if m and (m[1].split(".")[-1] in _EXCEPTION_NAMES
                  or m[1].split(".")[-1] == exc_type_name):
            result.append(arabize_message(line, exc_type_name))
            continue
        result.append(line)
    return "\n".join(result) + "\n"


def _clean(te, hidden=()):
    """يحذف إطارات مترجم أفعى ونظام الاستيراد الداخلية (وأي مسارات أخرى) من التتبع."""
    seen = set()
    hidden = (_PACKAGE_DIR, *hidden)
    while te is not None and id(te) not in seen:
        seen.add(id(te))
        te.stack[:] = [
            f for f in te.stack
            if not f.filename.startswith(hidden)
            and not f.filename.startswith(("<frozen importlib", "<frozen runpy"))
        ]
        for f in te.stack:
            # أعمدة الشيفرة المترجمة لا تطابق السطر العربي، فنلغي مؤشرات ^^^
            if hasattr(f, "colno") and (
                    f.filename.endswith(".af") or f.filename.startswith("<")):
                f.colno = f.end_colno = None
        _clean(te.__cause__, hidden[1:])
        te = te.__context__


def format_exception(exc, hidden=()):
    """ينسّق الاستثناء مع تتبع الاستدعاءات بالعربية.

    hidden: بدايات مسارات تُحذف إطاراتها أيضا (مثل مجلد مكتبة streamlit).
    """
    te = traceback.TracebackException(
        type(exc), exc, exc.__traceback__, compact=True)
    _clean(te, tuple(hidden))
    return _arabize_lines("".join(te.format()), type(exc).__name__)


def format_exception_only(exc):
    """ينسّق سطر الاستثناء فقط بالعربية."""
    text = "".join(traceback.format_exception_only(type(exc), exc))
    return _arabize_lines(text, type(exc).__name__)
