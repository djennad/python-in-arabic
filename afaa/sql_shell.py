"""طرفية SQL بالعربية:  afaa --sql مدرستي

تكتب استعلامات SQL بالعربية (أو بالإنجليزية) فتُنفَّذ على قاعدة البيانات مباشرة.
الاستعلام ينتهي بـ ؛ أو ; ويمكن أن يمتد على عدة أسطر.
"""

import sqlite3
import sys

from . import storage
from .sql import arabize_error, translate_sql

HELP = """الأوامر:
  .جداول           عرض الجداول
  .أعمدة الجدول    عرض أعمدة جدول
  .ترجم استعلام    عرض الاستعلام بلغة SQL الإنجليزية دون تنفيذه
  .مساعدة          هذه الرسالة
  .خروج            الخروج (أو Ctrl+D)
أنهِ كل استعلام بـ ؛ مثل:  اختر * من الطلاب؛"""


def format_table(columns, rows, limit=200):
    """جدول نصي بسيط بمحاذاة الأعمدة."""
    cells = [["" if v is None else str(v) for v in row] for row in rows[:limit]]
    widths = [max([len(c)] + [len(r[i]) for r in cells]) for i, c in enumerate(columns)]
    line = "-+-".join("-" * w for w in widths)
    out = [" | ".join(c.ljust(w) for c, w in zip(columns, widths)), line]
    out += [" | ".join(v.ljust(w) for v, w in zip(r, widths)) for r in cells]
    count = len(rows)
    out.append(f"({count} {'صف' if count == 1 else 'صفوف'})"
               + (f"، عُرض أول {limit}" if count > limit else ""))
    return "\n".join(out)


def execute(connection, text, write=print):
    """ينفّذ استعلاما واحدا ويطبع نتيجته."""
    sql = translate_sql(text)
    try:
        cursor = connection.execute(sql)
    except sqlite3.Error as exc:
        write("خطأ: " + arabize_error(str(exc)))
        return False
    if cursor.description:
        columns = [d[0] for d in cursor.description]
        write(format_table(columns, cursor.fetchall()))
    elif cursor.rowcount >= 0:
        write(f"تم ({cursor.rowcount} صف متأثر)")
    else:
        write("تم")
    return True


def command(connection, line, write=print):
    """الأوامر التي تبدأ بنقطة. يعيد False للخروج."""
    name, _, arg = line[1:].strip().partition(" ")
    arg = arg.strip()
    if name in ("خروج", "exit", "quit"):
        return False
    if name in ("جداول", "tables"):
        rows = connection.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                  "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        write("\n".join(r[0] for r in rows) or "لا توجد جداول بعد")
    elif name in ("أعمدة", "اعمدة", "schema") and arg:
        rows = connection.execute(f'PRAGMA table_info("{arg}")').fetchall()
        write("\n".join(f"{r[1]}  {r[2]}" for r in rows) or f"لا يوجد جدول باسم «{arg}»")
    elif name in ("ترجم", "translate") and arg:
        write(translate_sql(arg))
    else:
        write(HELP)
    return True


def interact(name=None):
    path = storage.resolve(name)
    connection = sqlite3.connect(path, isolation_level=None)
    connection.execute("PRAGMA foreign_keys = ON")
    where = "الذاكرة (مؤقتة)" if path == ":memory:" else path
    print(f"طرفية SQL بالعربية — القاعدة: {where}")
    print("أنهِ الاستعلام بـ ؛  واكتب «.مساعدة» للأوامر، و«.خروج» للخروج.")
    buffer = []
    while True:
        try:
            line = input("   ...> " if buffer else "sql> ")
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            buffer = []
            continue
        if not buffer and line.strip().startswith("."):
            if not command(connection, line.strip()):
                break
            continue
        buffer.append(line)
        text = "\n".join(buffer)
        if not text.strip():
            buffer = []
            continue
        if sqlite3.complete_statement(translate_sql(text)):
            execute(connection, text)
            buffer = []
    connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(interact(sys.argv[1] if len(sys.argv) > 1 else None))
