"""SQL بالعربية: يترجم استعلامات قواعد البيانات العربية إلى SQL تفهمه SQLite.

    اختر الاسم، العمر من الطلاب حيث العمر أكبر من ١٥ رتب حسب الاسم
    ← SELECT الاسم, العمر FROM الطلاب WHERE العمر > 15 ORDER BY الاسم

- أسماء الجداول والأعمدة العربية تبقى كما هي (SQLite تقبلها).
- النصوص '...' والأسماء بين علامتي تنصيص "..." لا تُترجم أبدًا: استخدم "..."
  لعمود اسمه كلمة محجوزة، مثل "جدول".
- الكلمات الإنجليزية تبقى كما هي، فيمكن خلط اللغتين.
- ؟ علامة المعاملات مثل ?، والفاصلة العربية ، مثل , والأرقام العربية مقبولة.
- المطابقة مرنة مع الهمزات والحركات مثل بقية أفعى: «اختر» و«إختر» سواء.
"""

import re

from .vocabulary import normalize, strip_marks

__all__ = ["translate_sql", "SQL_WORDS", "SQL_PHRASES", "SQL_FUNCTIONS", "SQL_TYPES"]

# ---------------------------------------------------------------------------
# القاموس
# ---------------------------------------------------------------------------
# عبارات من أكثر من كلمة (تُطابق أولًا، الأطول فالأقصر)
SQL_PHRASES = {
    "رتب حسب": "ORDER BY",
    "جمع حسب": "GROUP BY",
    "أدخل إلى": "INSERT INTO",
    "أدخل في": "INSERT INTO",
    "أدخل أو استبدل إلى": "INSERT OR REPLACE INTO",
    "أدخل أو تجاهل إلى": "INSERT OR IGNORE INTO",
    "مفتاح أساسي": "PRIMARY KEY",
    "مفتاح خارجي": "FOREIGN KEY",
    "زيادة تلقائية": "AUTOINCREMENT",
    "غير فارغ": "NOT NULL",
    "إذا لم يوجد": "IF NOT EXISTS",
    "إذا وجد": "IF EXISTS",
    "بلا تكرار": "DISTINCT",
    "ضم داخلي": "INNER JOIN",
    "ضم يساري": "LEFT JOIN",
    "ضم متقاطع": "CROSS JOIN",
    "أكبر من أو يساوي": ">=",
    "أصغر من أو يساوي": "<=",
    "أكبر من": ">",
    "أصغر من": "<",
    "لا يساوي": "!=",
    "يشير إلى": "REFERENCES",
    "عند الحذف": "ON DELETE",
    "عند التحديث": "ON UPDATE",
    "أعد تسمية": "RENAME",
    "اتحاد الكل": "UNION ALL",
    "الوقت الحالي": "CURRENT_TIMESTAMP",
    "التاريخ الحالي": "CURRENT_DATE",
}

# الكلمات المحجوزة
SQL_WORDS = {
    "اختر": "SELECT",
    "من": "FROM",
    "حيث": "WHERE",
    "و": "AND",
    "أو": "OR",
    "ليس": "NOT",
    "لا": "NOT",
    "في": "IN",
    "هو": "IS",
    "فارغ": "NULL",
    "فارغا": "NULL",
    "يشبه": "LIKE",
    "بين": "BETWEEN",
    "باسم": "AS",
    "يساوي": "=",
    "رتب": "ORDER",
    "جمع": "GROUP",
    "حسب": "BY",
    "تصاعديا": "ASC",
    "تنازليا": "DESC",
    "بشرط": "HAVING",
    "حد": "LIMIT",
    "تخطى": "OFFSET",
    "أدخل": "INSERT",
    "إلى": "TO",
    "القيم": "VALUES",
    "حدث": "UPDATE",
    "اجعل": "SET",
    "احذف": "DELETE",
    "أنشئ": "CREATE",
    "جدول": "TABLE",
    "إذا": "IF",
    "موجود": "EXISTS",
    "يوجد": "EXISTS",
    "أسقط": "DROP",
    "عدل": "ALTER",
    "أضف": "ADD",
    "عمود": "COLUMN",
    "فهرس": "INDEX",
    "على": "ON",
    "فريد": "UNIQUE",
    "افتراضي": "DEFAULT",
    "تحقق": "CHECK",
    "ضم": "JOIN",
    "اتحاد": "UNION",
    "الكل": "ALL",
    "حالة": "CASE",
    "عندما": "WHEN",
    "فإن": "THEN",
    "وإلا": "ELSE",
    "انتهى": "END",
    "ابدأ": "BEGIN",
    "اعتمد": "COMMIT",
    "تراجع": "ROLLBACK",
    "معاملة": "TRANSACTION",
    "صح": "TRUE",
    "خطأ": "FALSE",
    "تجاهل": "IGNORE",
    "تتالي": "CASCADE",
}

# الدوال
SQL_FUNCTIONS = {
    "عد": "COUNT",
    "مجموع": "SUM",
    "متوسط": "AVG",
    "أكبر": "MAX",
    "أصغر": "MIN",
    "طول": "LENGTH",
    "قرب": "ROUND",
    "مطلق": "ABS",
    "أحرف_كبيرة": "UPPER",
    "أحرف_صغيرة": "LOWER",
    "شذب": "TRIM",
    "استبدل": "REPLACE",
    "جزء": "SUBSTR",
    "عشوائي": "RANDOM",
    "أول_غير_فارغ": "COALESCE",
    "تاريخ_ووقت": "DATETIME",
}

# أنواع الأعمدة
SQL_TYPES = {
    "نص": "TEXT",
    "عدد_صحيح": "INTEGER",
    "عدد_عشري": "REAL",
    "منطقي": "BOOLEAN",
    "بيانات": "BLOB",
    "تاريخ": "DATE",
}

_WORDS = {}
for _table in (SQL_WORDS, SQL_FUNCTIONS, SQL_TYPES):
    for _arabic, _sql in _table.items():
        _WORDS[normalize(_arabic)] = _sql
_PHRASES = sorted(
    ((tuple(normalize(w) for w in arabic.split()), sql) for arabic, sql in SQL_PHRASES.items()),
    key=lambda item: -len(item[0]),
)
_INTO_AFTER = {"INSERT", "REPLACE", "IGNORE"}

# ---------------------------------------------------------------------------
# تقسيم الاستعلام إلى رموز
# ---------------------------------------------------------------------------
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫", "01234567890123456789.")
_PUNCTUATION = {"،": ",", "؛": ";", "؟": "?"}
_CLOSERS = {"'": "'", '"': '"', "`": "`", "[": "]"}


def _is_word_char(ch):
    return ch == "_" or ch.isalnum() or ("a" + ch).isidentifier()


def _tokenize(sql):
    """يعيد قائمة (نوع، نص). الأنواع: word, fixed (لا يُترجم), other."""
    tokens = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch.isspace():
            j = i
            while j < n and sql[j].isspace():
                j += 1
            tokens.append(("space", sql[i:j]))
            i = j
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j < 0 else j
            tokens.append(("fixed", sql[i:j]))
            i = j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            j = n if j < 0 else j + 2
            tokens.append(("fixed", sql[i:j]))
            i = j
        elif ch in _CLOSERS:
            # نص '...' أو اسم "..." (التكرار '' يعني علامة داخل النص)
            close = _CLOSERS[ch]
            j = i + 1
            while j < n:
                if sql[j] == close:
                    if close != "]" and j + 1 < n and sql[j + 1] == close:
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            tokens.append(("fixed", sql[i:j]))
            i = j
        elif ch.isdecimal() or (ch in ".٫" and i + 1 < n and sql[i + 1].isdecimal()):
            j = i + 1
            while j < n and (sql[j].isdecimal() or sql[j] in ".٫eE_"):
                j += 1
            tokens.append(("fixed", sql[i:j].translate(_DIGITS)))
            i = j
        elif ch in ":@$" and i + 1 < n and _is_word_char(sql[i + 1]):
            # معامل مسمى مثل :الاسم يبقى كما هو
            j = i + 1
            while j < n and _is_word_char(sql[j]):
                j += 1
            tokens.append(("fixed", sql[i:j]))
            i = j
        elif _is_word_char(ch):
            j = i + 1
            while j < n and _is_word_char(sql[j]):
                j += 1
            tokens.append(("word", sql[i:j]))
            i = j
        else:
            tokens.append(("other", _PUNCTUATION.get(ch, ch)))
            i += 1
    return tokens


def _following_words(tokens, start, count):
    """يجمع حتى count كلمة تبدأ من start، يفصل بينها فراغ فقط."""
    words, positions = [], []
    i = start
    while i < len(tokens) and len(words) < count:
        kind, text = tokens[i]
        if kind != "word":
            break
        words.append(normalize(text))
        positions.append(i)
        i += 1
        if i < len(tokens) and tokens[i][0] == "space":
            i += 1
    return words, positions


# ---------------------------------------------------------------------------
# الترجمة
# ---------------------------------------------------------------------------
_LONGEST = max(len(p) for p, _ in _PHRASES)


def translate_sql(sql):
    """يترجم استعلام SQL عربي إلى SQL قياسي (SQLite)."""
    tokens = _tokenize(sql)
    out = []
    last_keyword = None
    i = 0
    while i < len(tokens):
        kind, text = tokens[i]
        if kind != "word":
            out.append(text)
            i += 1
            continue
        words, positions = _following_words(tokens, i, _LONGEST)
        for phrase, replacement in _PHRASES:
            if tuple(words[:len(phrase)]) == phrase:
                out.append(replacement)
                last_keyword = replacement.split()[-1]
                i = positions[len(phrase) - 1] + 1
                break
        else:
            key = normalize(text)
            replacement = _WORDS.get(key)
            if replacement == "TO" and last_keyword in _INTO_AFTER:
                replacement = "INTO"
            if replacement is None:
                out.append(strip_marks(text))  # اسم جدول أو عمود
                last_keyword = None
            else:
                out.append(replacement)
                last_keyword = replacement
            i += 1
    return "".join(out)


# ---------------------------------------------------------------------------
# رسائل أخطاء SQLite بالعربية
# ---------------------------------------------------------------------------
_TO_ARABIC = {}
for _table in (SQL_TYPES, SQL_FUNCTIONS, SQL_WORDS, SQL_PHRASES):
    for _arabic, _sql in _table.items():
        _TO_ARABIC.setdefault(_sql.upper(), _arabic)
_TO_ARABIC["INTO"] = "إلى"


def _word(text):
    """الكلمة المحجوزة بالعربية (مثل FROM ← من)، أو الكلمة نفسها."""
    return _TO_ARABIC.get(text.upper(), text)


_ERRORS = [
    (r"no such table: (.+)", lambda m: f"لا يوجد جدول باسم «{m[1]}»"),
    (r"no such column: (.+)", lambda m: f"لا يوجد عمود باسم «{m[1]}»"),
    (r"table (.+?) already exists", lambda m: f"الجدول «{m[1]}» موجود مسبقا"),
    (r'near "(.+?)": syntax error', lambda m: f"خطأ في صياغة الاستعلام قرب «{_word(m[1])}»"),
    (r"incomplete input", lambda m: "الاستعلام غير مكتمل"),
    (r"UNIQUE constraint failed: (.+)",
     lambda m: f"القيمة مكررة في «{m[1]}» والعمود يشترط أن تكون فريدة"),
    (r"NOT NULL constraint failed: (.+)", lambda m: f"العمود «{m[1]}» لا يقبل قيمة فارغة"),
    (r"CHECK constraint failed: (.+)", lambda m: f"القيمة لا تحقق الشرط «{m[1]}»"),
    (r"FOREIGN KEY constraint failed",
     lambda m: "القيمة لا تشير إلى صف موجود (شرط المفتاح الخارجي)"),
    (r"datatype mismatch", lambda m: "نوع القيمة لا يطابق نوع العمود"),
    (r"table (.+?) has (\d+) columns but (\d+) values were supplied",
     lambda m: f"الجدول «{m[1]}» فيه {m[2]} أعمدة لكن أُعطيت {m[3]} قيم"),
    (r"(\d+) values for (\d+) columns", lambda m: f"أُعطيت {m[1]} قيم لـ {m[2]} أعمدة"),
    (r"Incorrect number of bindings supplied\. The current statement uses (\d+), and there are (\d+) supplied\.",
     lambda m: f"الاستعلام يحتاج {m[1]} من المعطيات (؟) لكن أُعطيت {m[2]}"),
    (r"no such function: (.+)", lambda m: f"لا توجد دالة باسم «{m[1]}»"),
    (r"ambiguous column name: (.+)",
     lambda m: f"اسم العمود «{m[1]}» غامض لأنه موجود في أكثر من جدول"),
    (r"You can only execute one statement at a time\.",
     lambda m: "يمكن تنفيذ استعلام واحد فقط في كل مرة، استخدم نفذ_الكل لعدة استعلامات"),
    (r"database is locked", lambda m: "قاعدة البيانات مقفلة من عملية أخرى"),
    (r"unable to open database file", lambda m: "تعذّر فتح ملف قاعدة البيانات"),
    (r"attempt to write a readonly database", lambda m: "قاعدة البيانات للقراءة فقط"),
    (r"Cannot operate on a closed database\.", lambda m: "قاعدة البيانات مغلقة"),
    (r"Error binding parameter (\S+)(?: - probably unsupported type)?\.?.*",
     lambda m: f"نوع المعطى رقم {m[1]} غير مدعوم (المدعوم: نص، عدد، بيانات، لاشيء)"),
    (r"type '(.+?)' is not supported", lambda m: f"النوع «{m[1]}» غير مدعوم في قاعدة البيانات"),
]
_ERRORS = [(re.compile(p), f) for p, f in _ERRORS]
_WHITESPACE = re.compile(r"\s+")


def describe(sql):
    """الاستعلام المترجم في سطر واحد (لرسائل الأخطاء)."""
    return _WHITESPACE.sub(" ", translate_sql(sql)).strip()


def arabize_error(message, query=None):
    """يترجم رسالة خطأ SQLite إلى العربية، ويضيف الاستعلام الأصلي إن أُعطي."""
    for pattern, arabic in _ERRORS:
        match = pattern.search(message)
        if match:
            message = arabic(match)
            break
    if query is not None:
        message += "\n  الاستعلام: " + _WHITESPACE.sub(" ", query).strip()
    return message
