"""اختبارات SQL العربية ومكتبة «قواعد_البيانات»."""

import contextlib
import io
import os
import sqlite3
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from afaa import run_source  # noqa: E402
from afaa.errors import format_exception  # noqa: E402
from afaa.sql import (  # noqa: E402
    SQL_FUNCTIONS, SQL_PHRASES, SQL_TYPES, SQL_WORDS, arabize_error, translate_sql,
)


class TranslateSqlTests(unittest.TestCase):
    def check(self, arabic, sql):
        self.assertEqual(translate_sql(arabic), sql)

    def test_select(self):
        self.check("اختر الاسم، العمر من الطلاب حيث العمر أكبر من ١٥ رتب حسب الاسم تنازليا حد ٥",
                   "SELECT الاسم, العمر FROM الطلاب WHERE العمر > 15 ORDER BY الاسم DESC LIMIT 5")

    def test_create_table(self):
        self.check("أنشئ جدول إذا لم يوجد ط (م عدد_صحيح مفتاح أساسي زيادة تلقائية، س نص غير فارغ فريد)",
                   "CREATE TABLE IF NOT EXISTS ط (م INTEGER PRIMARY KEY AUTOINCREMENT, س TEXT NOT NULL UNIQUE)")

    def test_insert_update_delete(self):
        self.check("أدخل إلى ط (أ، ب) القيم (؟، ؟)", "INSERT INTO ط (أ, ب) VALUES (?, ?)")
        self.check("أدخل أو تجاهل إلى ط القيم (١)", "INSERT OR IGNORE INTO ط VALUES (1)")
        self.check("حدث ط اجعل أ = أ + ١ حيث ب هو ليس فارغ", "UPDATE ط SET أ = أ + 1 WHERE ب IS NOT NULL")
        self.check("احذف من ط حيث أ بين ١ و ٣", "DELETE FROM ط WHERE أ BETWEEN 1 AND 3")

    def test_aggregates_and_grouping(self):
        self.check("اختر عد(*) باسم ع، متوسط(أ) من ط جمّع حسب ب بشرط عد(*) أكبر من أو يساوي ٢",
                   "SELECT COUNT(*) AS ع, AVG(أ) FROM ط GROUP BY ب HAVING COUNT(*) >= 2")

    def test_join_and_case(self):
        self.check("اختر أ.س من ط باسم أ ضم يساري ك على أ.م = ك.م",
                   "SELECT أ.س FROM ط AS أ LEFT JOIN ك ON أ.م = ك.م")
        self.check("اختر حالة عندما أ أصغر من ٠ فإن 'سالب' وإلا 'موجب' انتهى من ط",
                   "SELECT CASE WHEN أ < 0 THEN 'سالب' ELSE 'موجب' END FROM ط")

    def test_strings_quoted_names_comments_and_params_untouched(self):
        self.check("اختر \"جدول\" من ط حيث س = 'اختر من' و ع = :الاسم -- اختر من",
                   "SELECT \"جدول\" FROM ط WHERE س = 'اختر من' AND ع = :الاسم -- اختر من")
        self.check("اختر 'it''s من' من ط", "SELECT 'it''s من' FROM ط")

    def test_flexible_spelling_and_english(self):
        self.check("إختر  الإسمُ\nمن ط", "SELECT  الإسم\nFROM ط")
        self.check("SELECT * FROM ط WHERE أ > 1", "SELECT * FROM ط WHERE أ > 1")
        self.check("اختر ١٫٥ من ط", "SELECT 1.5 FROM ط")

    def test_every_translation_is_valid_sqlite(self):
        db = sqlite3.connect(":memory:")
        script = """
            أنشئ جدول ط (م عدد_صحيح مفتاح أساسي زيادة تلقائية، س نص غير فارغ افتراضي 'أ'، ع عدد_عشري، ت تاريخ)؛
            أنشئ جدول ك (م عدد_صحيح، ط_م عدد_صحيح يشير إلى ط(م) عند الحذف تتالي)؛
            أنشئ فهرس ف على ط (س)؛
            أدخل إلى ط (س، ع) القيم ('أ'، ١٫٥)، ('ب'، ٢)؛
            حدث ط اجعل ع = قرب(ع) حيث س في ('أ')؛
            اختر بلا تكرار أحرف_كبيرة(س)، طول(س)، مطلق(ع)، أول_غير_فارغ(ت، 'لا') من ط اتحاد الكل اختر 'ج'، ١، ١، ١؛
            عدل جدول ك أضف عمود ن نص؛
            عدل جدول ك أعد تسمية إلى ل؛
            أسقط جدول إذا وجد ل؛
        """
        db.executescript(translate_sql(script))

    def test_vocabulary_documented(self):
        with open(os.path.join(ROOT, "docs", "database.md"), encoding="utf-8") as fh:
            docs = fh.read()
        for table in (SQL_WORDS, SQL_PHRASES, SQL_FUNCTIONS, SQL_TYPES):
            for arabic in table:
                self.assertIn(f"`{arabic}`", docs, arabic)

    def test_arabic_errors(self):
        self.assertEqual(arabize_error("no such table: الطلاب"), "لا يوجد جدول باسم «الطلاب»")
        self.assertEqual(arabize_error('near "FROM": syntax error'), "خطأ في صياغة الاستعلام قرب «من»")
        self.assertIn("الاستعلام: اختر", arabize_error("x", "اختر\n  س"))


def run(code, cwd):
    out = io.StringIO()
    old = os.getcwd()
    os.chdir(cwd)
    try:
        with contextlib.redirect_stdout(out):
            namespace = run_source(textwrap.dedent(code), module_name="__afaa_db_test__")
    finally:
        os.chdir(old)
    return out.getvalue(), namespace


class DatabaseLibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_crud_and_rows(self):
        out, ns = run("""
            من قواعد_البيانات استورد قاعدة_بيانات
            ق = قاعدة_بيانات("مدرستي")
            ق.نفذ("أنشئ جدول الطلاب (المعرف عدد_صحيح مفتاح أساسي، الاسم نص، العمر عدد_صحيح)")
            ق.نفذ("أدخل إلى الطلاب (الاسم، العمر) القيم (؟، ؟)"، "أحمد"، ١٦)
            اطبع(ق.آخر_معرف)
            ق.نفذ_عدة("أدخل إلى الطلاب (الاسم، العمر) القيم (؟، ؟)"، [("سارة"، ١٥)، ("يوسف"، ١٧)])
            اطبع(ق.نفذ("حدث الطلاب اجعل العمر = العمر + ١ حيث العمر أصغر من ١٧"))
            لكل ط في ق.استعلم("اختر * من الطلاب رتب حسب العمر"):
                اطبع(ط["الاسم"]، ط.العمر)
            اطبع(ق.قيمة("اختر عد(*) من الطلاب حيث الاسم يشبه ؟"، "%ر%"))
            اطبع(ق.استعلم_واحدا("اختر الاسم من الطلاب حيث العمر = ؟"، [٩٩]))
            اطبع(ق.استعلم_واحدا("اختر الاسم من الطلاب حيث العمر = :ع"، {"ع": ١٧}))
            اطبع(ق.الجداول()، ق.أعمدة("الطلاب"))
            ق.أغلق()
        """, self.dir)
        self.assertEqual(out.splitlines(), [
            "1", "2", "سارة 16", "أحمد 17", "يوسف 17", "1", "None", "{'الاسم': 'أحمد'}",
            "['الطلاب'] ['المعرف', 'الاسم', 'العمر']",
        ])
        self.assertTrue(os.path.exists(os.path.join(self.dir, "مدرستي.db")))

    def test_data_persists_in_file(self):
        run('من قواعد_البيانات استورد *\nق = قاعدة_بيانات("د")\n'
            'ق.نفذ("أنشئ جدول ت (س نص)")\nق.نفذ("أدخل إلى ت القيم (\'باق\')")\n', self.dir)
        out, _ = run('من قواعد_البيانات استورد *\n'
                     'اطبع(قاعدة_بيانات("د").قيمة("اختر س من ت"))\n', self.dir)
        self.assertEqual(out, "باق\n")

    def test_transaction_rolls_back(self):
        out, _ = run("""
            من قواعد_البيانات استورد *
            ق = قاعدة_بيانات()
            ق.نفذ("أنشئ جدول ح (الرصيد عدد_صحيح تحقق (الرصيد أكبر من أو يساوي ٠))")
            ق.نفذ("أدخل إلى ح القيم (١٠٠)")
            حاول:
                مع ق.معاملة():
                    ق.نفذ("حدث ح اجعل الرصيد = الرصيد - ٣٠")
                    ق.نفذ("حدث ح اجعل الرصيد = الرصيد - ٩٠٠")
            باستثناء خطأ_قاعدة_بيانات باسم خ:
                اطبع("ألغيت")
            اطبع(ق.قيمة("اختر الرصيد من ح"))
            مع ق.معاملة():
                ق.نفذ("حدث ح اجعل الرصيد = ٥٠")
            اطبع(ق.قيمة("اختر الرصيد من ح"))
        """, self.dir)
        self.assertEqual(out, "ألغيت\n100\n50\n")

    def test_script_and_translation_helper(self):
        out, _ = run("""
            من قواعد_البيانات استورد *
            ق = قاعدة_بيانات()
            ق.نفذ_الكل('''
                أنشئ جدول أ (س عدد_صحيح)؛
                أدخل إلى أ القيم (١)، (٢)، (٣)؛
            ''')
            اطبع(ق.قيمة("اختر مجموع(س) من أ"))
            اطبع(ترجم_استعلام("اختر * من أ"))
        """, self.dir)
        self.assertEqual(out, "6\nSELECT * FROM أ\n")

    def error_text(self, code):
        try:
            run(code, self.dir)
        except BaseException as exc:  # noqa: BLE001
            return format_exception(exc)
        self.fail("لم يحدث خطأ")

    def test_errors_are_arabic_and_show_the_query(self):
        text = self.error_text('من قواعد_البيانات استورد *\nقاعدة_بيانات().استعلم("اختر * من المفقود")\n')
        self.assertIn("خطأ_قاعدة_بيانات: لا يوجد جدول باسم «المفقود»", text)
        self.assertIn("الاستعلام: اختر * من المفقود", text)
        self.assertNotIn("sqlite3", text)
        text = self.error_text('من قواعد_البيانات استورد *\nقاعدة_بيانات().نفذ("اختر من من")\n')
        self.assertIn("خطأ في صياغة الاستعلام", text)
        text = self.error_text('من قواعد_البيانات استورد *\nق = قاعدة_بيانات()\n'
                               'ق.نفذ("أنشئ جدول ت (س نص، ع نص)")\nق.نفذ("أدخل إلى ت القيم (؟، ؟)"، ١)\n')
        self.assertIn("يحتاج 2 من المعطيات", text)

    def test_row_attribute_error(self):
        text = self.error_text('من قواعد_البيانات استورد *\nق = قاعدة_بيانات()\n'
                               'ق.نفذ("أنشئ جدول ت (س نص)")\nق.نفذ("أدخل إلى ت القيم (١)")\n'
                               'اطبع(ق.استعلم_واحدا("اختر * من ت").ع)\n')
        self.assertIn("لا يوجد عمود باسم «ع»", text)

    def test_delete_database(self):
        out, _ = run("""
            من قواعد_البيانات استورد *
            قاعدة_بيانات("مؤقتة").أغلق()
            احذف_قاعدة("مؤقتة")
            استورد os
            اطبع(os.path.exists("مؤقتة.db"))
        """, self.dir)
        self.assertEqual(out, "False\n")


class SqlShellTests(unittest.TestCase):
    def test_shell_session(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            session = "\n".join([
                "أنشئ جدول المدن (الاسم نص، السكان عدد_صحيح)؛",
                "أدخل إلى المدن القيم ('الجزائر'، ٤٥٠)، ('وهران'،",
                "  ١٦٠)؛",
                "اختر * من المدن رتب حسب السكان؛",
                ".جداول",
                ".ترجم اختر عد(*) من المدن",
                "اختر المفقود من المدن؛",
                ".خروج",
            ]) + "\n"
            env = dict(os.environ, PYTHONPATH=ROOT, PYTHONIOENCODING="utf-8")
            result = subprocess.run([sys.executable, "-m", "afaa", "--sql", "مدن"], cwd=folder,
                                    input=session, capture_output=True, text=True,
                                    encoding="utf-8", env=env)
            self.assertTrue(os.path.exists(os.path.join(folder, "مدن.db")))
        out = result.stdout
        self.assertIn("تم (2 صف متأثر)", out)
        self.assertIn("وهران   | 160", out)
        self.assertIn("(2 صفوف)", out)
        self.assertIn("SELECT COUNT(*) FROM المدن", out)
        self.assertIn("خطأ: لا يوجد عمود باسم «المفقود»", out)

    def test_translate_sql_command(self):
        import subprocess
        env = dict(os.environ, PYTHONPATH=ROOT, PYTHONIOENCODING="utf-8")
        result = subprocess.run([sys.executable, "-m", "afaa", "--translate-sql", "اختر * من ط"],
                                capture_output=True, text=True, encoding="utf-8", env=env)
        self.assertEqual(result.stdout, "SELECT * FROM ط\n")


if __name__ == "__main__":
    unittest.main()
