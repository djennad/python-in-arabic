"""المترجم: يحوّل شيفرة أفعى (العربية) إلى شيفرة بايثون والعكس.

تتم الترجمة على مرحلتين:

1. **مرحلة التمهيد** (``_prepass``): تمرّ على النص حرفًا حرفًا فتحوّل الأرقام
   العربية (٠١٢...) والفاصلة العربية (،) والفاصلة المنقوطة (؛) وعلامة النسبة (٪)
   ونصوص «...» إلى مقابلاتها، وتحذف الحركات من الأسماء، وتترجم التعابير داخل
   النصوص المنسقة (f-strings)، ولا تمسّ محتوى النصوص والتعليقات.
2. **مرحلة الرموز** (``_translate_tokens``): تستخدم محلل الرموز في بايثون
   (tokenize) لاستبدال الأسماء وفق القاموس، مع الحفاظ على أرقام الأسطر
   حتى تشير رسائل الأخطاء إلى السطر الصحيح في الملف العربي.
"""

import io
import tokenize

from . import vocabulary as _v

__all__ = ["translate", "to_arabic"]

_DIGITS = {}
for _i, _c in enumerate("٠١٢٣٤٥٦٧٨٩"):
    _DIGITS[ord(_c)] = str(_i)
for _i, _c in enumerate("۰۱۲۳۴۵۶۷۸۹"):
    _DIGITS[ord(_c)] = str(_i)
_DIGITS[ord("٫")] = "."   # الفاصلة العشرية العربية
_DIGITS[ord("٬")] = "_"   # فاصل الآلاف العربي

_PUNCTUATION = {"،": ",", "؛": ";", "٪": "%"}

_STRING_PREFIXES = {"r", "u", "b", "f", "br", "rb", "fr", "rf"}


class _Direction:
    def __init__(self, names, strings, two_words, arabic):
        self.names = names
        self.strings = strings
        self.two_words = two_words
        self.arabic = arabic  # هل المصدر عربي؟ (يفعّل التطبيع والأرقام العربية)

    def lookup(self, name):
        if self.arabic:
            return self.names.get(_v.normalize(name))
        return self.names.get(name)


_TO_PYTHON = _Direction(_v.ARABIC_TO_PYTHON, _v.STRINGS_TO_PYTHON,
                        _v.TWO_WORD_ARABIC, arabic=True)
_TO_ARABIC = _Direction(_v.PYTHON_TO_ARABIC, _v.STRINGS_TO_ARABIC,
                        _v.TWO_WORD_PYTHON, arabic=False)


def translate(source):
    """يترجم شيفرة أفعى إلى شيفرة بايثون قابلة للتنفيذ."""
    return _translate(source, _TO_PYTHON)


def to_arabic(source):
    """يترجم شيفرة بايثون إلى شيفرة أفعى."""
    return _translate(source, _TO_ARABIC)


def _translate(source, direction):
    return _translate_tokens(_prepass(source, direction), direction)


# ---------------------------------------------------------------------------
# مرحلة التمهيد
# ---------------------------------------------------------------------------
def _is_ident_start(ch):
    return ch.isidentifier()


def _is_ident_char(ch):
    return ("a" + ch).isidentifier()


def _prepass(src, direction):
    out = []
    i = 0
    n = len(src)
    arabic = direction.arabic
    while i < n:
        ch = src[i]
        if ch == "#":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(src[i:j])
            i = j
        elif ch in "\"'":
            text, i = _scan_string(src, i, "", direction)
            out.append(text)
        elif ch == "«" and arabic:
            text, i = _scan_guillemets(src, i)
            out.append(text)
        elif _is_ident_start(ch):
            j = i + 1
            while j < n and _is_ident_char(src[j]):
                j += 1
            word = src[i:j]
            if j < n and src[j] in "\"'" and word.lower() in _STRING_PREFIXES:
                text, i = _scan_string(src, j, word.lower(), direction)
                out.append(word + text)
                continue
            out.append(_v.strip_marks(word) if arabic else word)
            i = j
        elif ch.isdecimal():
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in "._٫٬"):
                j += 1
            out.append(src[i:j].translate(_DIGITS) if arabic else src[i:j])
            i = j
        else:
            out.append(_PUNCTUATION.get(ch, ch) if arabic else ch)
            i += 1
    return "".join(out)


def _scan_guillemets(src, i):
    """يحوّل «نص» إلى "نص" (سطر واحد فقط)."""
    end = src.find("»", i + 1)
    newline = src.find("\n", i + 1)
    if end < 0 or (0 <= newline < end):
        return "«", i + 1
    body = []
    content = src[i + 1:end]
    k = 0
    while k < len(content):
        c = content[k]
        if c == "\\":
            body.append(content[k:k + 2])
            k += 2
            continue
        body.append('\\"' if c == '"' else c)
        k += 1
    return '"' + "".join(body) + '"', end + 1


def _scan_string(src, i, prefix, direction):
    """يقرأ نصًا حرفيًا يبدأ عند الموضع i ويعيد (النص بعد المعالجة، موضع النهاية).

    النصوص العادية تُنسخ كما هي؛ أما النصوص المنسقة (f) فتُترجم التعابير داخلها.
    """
    n = len(src)
    quote = src[i]
    triple = src.startswith(quote * 3, i)
    delim = quote * 3 if triple else quote
    j = i + len(delim)
    is_f = "f" in prefix
    is_raw = "r" in prefix
    parts = [delim]
    while j < n:
        ch = src[j]
        if ch == "\\" and (not is_raw or src[j + 1:j + 2] in (quote, "\\")):
            parts.append(src[j:j + 2])
            j += 2
            continue
        if src.startswith(delim, j):
            parts.append(delim)
            return "".join(parts), j + len(delim)
        if ch == "\n" and not triple:
            return "".join(parts), j  # نص غير مغلق: يتركه لبايثون ليبلّغ عنه
        if is_f and ch == "{":
            if src.startswith("{{", j):
                parts.append("{{")
                j += 2
                continue
            text, j = _scan_replacement_field(src, j, delim, direction)
            parts.append(text)
            continue
        parts.append(ch)
        j += 1
    return "".join(parts), n


def _scan_replacement_field(src, j, delim, direction):
    """يعالج حقل الاستبدال {تعبير!تحويل:تنسيق} داخل نص منسق."""
    n = len(src)
    k = j + 1
    depth = 0
    while k < n:
        ch = src[k]
        if src.startswith(delim, k) and ch in "\"'" and depth == 0:
            break
        if ch in "\"'":
            _, k = _scan_string(src, k, "", direction)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and ch == "!" and src[k + 1:k + 2] != "=":
            break
        elif depth == 0 and ch == ":":
            break
        k += 1
    parts = ["{", _translate_expression(src[j + 1:k], direction)]
    if k < n and src[k] == "!":
        start = k
        while k < n and src[k] not in ":}":
            k += 1
        parts.append(src[start:k])
    if k < n and src[k] == ":":
        parts.append(":")
        k += 1
        while k < n and src[k] != "}":
            if src[k] == "{":
                text, k = _scan_replacement_field(src, k, delim, direction)
                parts.append(text)
            else:
                parts.append(src[k])
                k += 1
    if k < n and src[k] == "}":
        parts.append("}")
        k += 1
    return "".join(parts), k


def _translate_expression(expr, direction):
    stripped = expr.lstrip()
    lead = expr[:len(expr) - len(stripped)]
    try:
        return lead + _translate(stripped, direction)
    except Exception:  # نترك بايثون يبلّغ عن الخطأ
        return expr


# ---------------------------------------------------------------------------
# مرحلة الرموز
# ---------------------------------------------------------------------------
def _translate_tokens(src, direction):
    tokens = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            tokens.append(tok)
    except (tokenize.TokenError, SyntaxError):
        pass  # شيفرة غير مكتملة: نترجم ما أمكن ونترك الباقي لبايثون

    edits = []
    count = len(tokens)
    idx = 0
    while idx < count:
        tok = tokens[idx]
        if tok.type == tokenize.NAME:
            if direction.two_words and idx + 1 < count:
                nxt = tokens[idx + 1]
                pair = (_v.normalize(tok.string), _v.normalize(nxt.string))
                if (nxt.type == tokenize.NAME and nxt.start[0] == tok.end[0]
                        and pair in direction.two_words):
                    edits.append((tok.start, nxt.end, direction.two_words[pair]))
                    idx += 2
                    continue
            replacement = direction.lookup(tok.string)
            if replacement is not None and replacement != tok.string:
                edits.append((tok.start, tok.end, replacement))
        elif tok.type == tokenize.STRING and tok.start[0] == tok.end[0]:
            quote = tok.string[-1]
            if tok.string[:1] == quote:
                inner = tok.string[1:-1]
                if inner in direction.strings:
                    edits.append((tok.start, tok.end,
                                  quote + direction.strings[inner] + quote))
        idx += 1

    if not edits:
        return src

    line_offsets = [0]
    for line in io.StringIO(src):
        line_offsets.append(line_offsets[-1] + len(line))

    def offset(pos):
        row, col = pos
        return line_offsets[row - 1] + col

    out = []
    last = 0
    for start, end, text in edits:
        a, b = offset(start), offset(end)
        out.append(src[last:a])
        out.append(text)
        last = b
    out.append(src[last:])
    return "".join(out)
