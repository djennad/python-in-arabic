"""اختبارات لغة أفعى."""

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import afaa  # noqa: E402
from afaa import translate, to_arabic, run_source  # noqa: E402
from afaa.errors import format_exception  # noqa: E402
from afaa import vocabulary  # noqa: E402


def run(code):
    """ينفّذ شيفرة أفعى ويعيد ما طُبع."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        run_source(textwrap.dedent(code), module_name="__afaa_test__")
    return out.getvalue()


class TranslatorTests(unittest.TestCase):
    def test_keywords(self):
        self.assertEqual(translate("إذا س و ليس ص:\n    مرر"),
                         "if س and not ص:\n    pass")

    def test_elif_two_words(self):
        self.assertEqual(translate("وإلا إذا س:"), "elif س:")
        self.assertEqual(translate("وإلا_إذا س:"), "elif س:")

    def test_hamza_and_diacritics_normalized(self):
        self.assertEqual(translate("اذا"), "if")
        self.assertEqual(translate("إذَا"), "if")
        self.assertEqual(translate("أخيراً:"), "finally:")
        self.assertEqual(translate("مدي(٣)"), "range(3)")

    def test_arabic_digits_and_punctuation(self):
        self.assertEqual(translate("[١، ٢٫٥، ١٬٠٠٠]؛ ٧ ٪ ٣"),
                         "[1, 2.5, 1_000]; 7 % 3")
        self.assertEqual(translate("۱۲"), "12")

    def test_digits_inside_identifiers_kept(self):
        self.assertEqual(translate("س١ = ٢"), "س١ = 2")

    def test_strings_and_comments_untouched(self):
        src = 'اطبع("إذا لكل ١، ٢") # إذا في\n'
        self.assertEqual(translate(src), 'print("إذا لكل ١، ٢") # إذا في\n')

    def test_guillemets(self):
        self.assertEqual(translate('اطبع(«قال "مرحبا"»)'),
                         'print("قال \\"مرحبا\\"")')

    def test_fstring_expressions_translated(self):
        self.assertEqual(translate('f"{طول(س)!r:>{عرض}} و {صح}"'),
                         'f"{len(س)!r:>{عرض}} و {True}"')

    def test_template_string_expressions_translated(self):
        self.assertEqual(translate('t"{طول(س)} {٢}"'), 't"{len(س)} {2}"')

    def test_main_string(self):
        self.assertEqual(translate('إذا __اسم__ == "__رئيسي__":'),
                         'if __name__ == "__main__":')

    def test_line_numbers_preserved(self):
        src = "إذا صح:\n    اطبع(١)\nوإلا:\n    مرر\n"
        self.assertEqual(translate(src).count("\n"), src.count("\n"))

    def test_incomplete_code_does_not_raise(self):
        translate("دالة س(:\n    '''نص غير مغلق")

    def test_round_trip(self):
        python = textwrap.dedent('''\
            class A(object):
                def __init__(self, x=None):
                    self.x = [i for i in range(10) if i % 2 == 0 and x is not None]
            ''')
        arabic = to_arabic(python)
        self.assertIn("صنف", arabic)
        self.assertIn("__تهيئة__", arabic)
        self.assertEqual(translate(arabic), python)

    def test_vocabulary_has_all_python_keywords(self):
        import keyword
        covered = set(vocabulary.KEYWORDS) | set(vocabulary.SOFT_KEYWORDS)
        missing = set(keyword.kwlist) - covered
        self.assertEqual(missing, set())

    def test_vocabulary_covers_builtins(self):
        import builtins
        covered = set(vocabulary.PYTHON_TO_ARABIC)
        public = {n for n in dir(builtins)
                  if not n.startswith("_") and n[0].islower()
                  and n not in {"copyright", "credits", "license", "quit",
                                "exec", "eval"}}
        self.assertEqual(public - covered, set())


class LanguageTests(unittest.TestCase):
    def test_control_flow(self):
        out = run("""
            لكل س في مدى(٥):
                إذا س == ١:
                    استمر
                وإلا إذا س == ٣:
                    اكسر
                اطبع(س)
            وإلا:
                اطبع("لا")
            ع = ٠
            طالما صح:
                ع += ١
                إذا ع > ٢: اكسر
            اطبع(ع)
        """)
        self.assertEqual(out, "0\n2\n3\n")

    def test_functions_and_closures(self):
        out = run("""
            دالة صانع():
                ع = ٠
                دالة زد(خطوة=١، *معطيات، **معطيات_مسماة):
                    غير_محلي ع
                    ع += خطوة
                    أرجع ع
                أرجع زد
            ز = صانع()
            ز()
            اطبع(ز(خطوة=٥))
            اطبع((لامدا أ، ب: أ * ب)(٣، ٤))
        """)
        self.assertEqual(out, "6\n12\n")

    def test_global(self):
        out = run("""
            ع = ١
            دالة غير():
                عمومي ع
                ع = ٩
            غير()
            اطبع(ع)
        """)
        self.assertEqual(out, "9\n")

    def test_classes_inheritance_dunders(self):
        out = run("""
            صنف متجه:
                دالة __تهيئة__(ذات، س، ص):
                    ذات.س، ذات.ص = س، ص
                دالة __جمع__(ذات، آخر):
                    أرجع متجه(ذات.س + آخر.س، ذات.ص + آخر.ص)
                دالة __يساوي__(ذات، آخر):
                    أرجع (ذات.س، ذات.ص) == (آخر.س، آخر.ص)
                دالة __نص__(ذات):
                    أرجع f"({ذات.س}، {ذات.ص})"
                دالة __طول__(ذات):
                    أرجع ٢
                @دالة_صنف
                دالة صفري(الصنف):
                    أرجع الصنف(٠، ٠)
                @دالة_ساكنة
                دالة وصف():
                    أرجع "متجه"
                @خاصية
                دالة مجموع_المركبات(ذات):
                    أرجع ذات.س + ذات.ص
            صنف متجه_مسمى(متجه):
                دالة __تهيئة__(ذات، اسم، *معطيات):
                    الأب().__تهيئة__(*معطيات)
                    ذات.اسم = اسم
            م = متجه_مسمى("أ"، ١، ٢) + متجه(٣، ٤)
            اطبع(م، طول(م)، م == متجه(٤، ٦)، متجه.صفري()، متجه.وصف())
            اطبع(م.مجموع_المركبات، من_نوع(م، متجه)، صنف_فرعي_من(متجه_مسمى، متجه))
        """)
        self.assertEqual(out, "(4، 6) 2 True (0، 0) متجه\n10 True True\n")

    def test_exceptions(self):
        out = run("""
            صنف خطئي(استثناء):
                مرر
            حاول:
                ارفع خطئي("رسالة") من خطأ_قيمة("سبب")
            باستثناء (خطأ_نوع، خطئي) باسم خ:
                اطبع(خ، نوع(خ.__cause__).__اسم__)
            وإلا:
                اطبع("لا")
            أخيرا:
                اطبع("أخيرا")
            حاول:
                {}["مفقود"]
            باستثناء خطأ_مفتاح:
                اطبع("مفتاح")
        """)
        self.assertEqual(out, "رسالة ValueError\nأخيرا\nمفتاح\n")

    def test_generators_and_comprehensions(self):
        out = run("""
            دالة مولد(ن):
                لكل ع في مدى(ن):
                    أنتج ع
                أنتج من [٩٩]
            اطبع(قائمة(مولد(٣)))
            اطبع([س * ٢ لكل س في مدى(٤) إذا س % ٢ == ٠])
            اطبع({س: س ** ٢ لكل س في مدى(٣)})
            اطبع(مجموع(س لكل س في مدى(١٠)))
            اطبع(مرتبة({٣، ١، ٢}، عكسي=صح))
        """)
        self.assertEqual(out, "[0, 1, 2, 99]\n[0, 4]\n{0: 0, 1: 1, 2: 4}\n45\n[3, 2, 1]\n")

    def test_context_manager(self):
        out = run("""
            صنف سياق:
                دالة __دخول__(ذات):
                    اطبع("دخول")
                    أرجع ٥
                دالة __خروج__(ذات، نوع_، قيمة، تتبع):
                    اطبع("خروج")
                    أرجع صح
            مع سياق() باسم س:
                اطبع(س)
                ارفع خطأ_قيمة
            اطبع("بعد")
        """)
        self.assertEqual(out, "دخول\n5\nخروج\nبعد\n")

    def test_match(self):
        out = run("""
            دالة صف_(ق):
                طابق ق:
                    حالة []:
                        أرجع "فارغة"
                    حالة [س]:
                        أرجع f"عنصر {س}"
                    حالة {"نوع": "نقطة"، "س": س}:
                        أرجع f"نقطة {س}"
                    حالة عدد_صحيح() | عدد_عشري() باسم ع إذا ع > ٠:
                        أرجع "موجب"
                    حالة _:
                        أرجع "أخرى"
            لكل ق في ([]، [١]، {"نوع": "نقطة"، "س": ٣}، ٢٫٥، -١):
                اطبع(صف_(ق))
        """)
        self.assertEqual(out, "فارغة\nعنصر 1\nنقطة 3\nموجب\nأخرى\n")

    def test_async(self):
        out = run("""
            استورد تزامن
            غير_متزامن دالة مهمة(ع):
                انتظر تزامن.نم(٠)
                أرجع ع * ٢
            غير_متزامن دالة مولد_غير_متزامن():
                لكل ع في مدى(٢):
                    أنتج ع
            غير_متزامن دالة رئيسية():
                نتائج = انتظر تزامن.اجمع(*[مهمة(ع) لكل ع في مدى(٣)])
                اطبع(نتائج)
                غير_متزامن لكل ع في مولد_غير_متزامن():
                    اطبع(ع)
            تزامن.شغل(رئيسية())
        """)
        self.assertEqual(out, "[0, 2, 4]\n0\n1\n")

    def test_walrus_unpacking_assert_del(self):
        out = run("""
            إذا (ن := ٣) > ٢:
                اطبع(ن)
            أ، *ب = [١، ٢، ٣]
            اطبع(أ، ب)
            تأكد ٥ ليس في ب
            احذف ب[٠]
            اطبع(ب، ب هو ليس لاشيء)
        """)
        self.assertEqual(out, "3\n1 [2, 3]\n[3] True\n")

    def test_decorators_and_stdlib(self):
        out = run("""
            من أدوات_الدوال استورد ذاكرة_مؤقتة
            من مجموعات استورد عداد
            من أصناف_البيانات استورد صنف_بيانات
            استورد رياضيات
            @ذاكرة_مؤقتة(maxsize=None)
            دالة فيب(ن):
                أرجع ن إذا ن < ٢ وإلا فيب(ن - ١) + فيب(ن - ٢)
            @صنف_بيانات
            صنف نقطة:
                س: عدد_صحيح
                ص: عدد_صحيح = ٠
            اطبع(فيب(٥٠)، نقطة(١)، رياضيات.جذر(١٦)، عداد("أبب")["ب"])
        """)
        self.assertEqual(out, "12586269025 نقطة(س=1, ص=0) 4.0 2\n")

    def test_string_and_list_methods(self):
        out = run("""
            ن = "  مرحبا بالعالم  ".شذب()
            اطبع(ن.قسم()، "-".اربط(["أ"، "ب"])، ن.استبدل("مرحبا"، "أهلا"))
            ق = [٣، ١]
            ق.أضف(٢)
            ق.رتب()
            اطبع(ق، ق.انزع()، ق.عد(١))
            ق_ = {"أ": ١}
            اطبع(قائمة(ق_.المفاتيح())، ق_.احصل("ب"، ٠))
        """)
        self.assertEqual(
            out, "['مرحبا', 'بالعالم'] أ-ب أهلا بالعالم\n[1, 2] 3 1\n['أ'] 0\n")

    def test_exec_eval(self):
        out = run("""
            نفذ("س = ٤")
            اطبع(قيم("س * ٢"))
        """)
        self.assertEqual(out, "8\n")

    def test_print_kwargs(self):
        self.assertEqual(run('اطبع(١، ٢، فاصل="-"، نهاية="!")'), "1-2!")

    @unittest.skipIf(sys.version_info < (3, 11), "except* يتطلب بايثون 3.11")
    def test_exception_groups(self):
        out = run("""
            حاول:
                ارفع مجموعة_استثناءات("م"، [خطأ_قيمة(١)، خطأ_نوع(٢)])
            باستثناء* خطأ_قيمة:
                اطبع("قيمة")
            باستثناء* خطأ_نوع:
                اطبع("نوع")
        """)
        self.assertEqual(out, "قيمة\nنوع\n")


class ErrorTests(unittest.TestCase):
    def error_text(self, code):
        try:
            run(code)
        except BaseException as exc:  # noqa: BLE001
            return format_exception(exc)
        self.fail("لم يحدث خطأ")

    def test_name_error_in_arabic(self):
        text = self.error_text("اطبع(غير_موجود)\n")
        self.assertIn("تتبع الاستدعاءات", text)
        self.assertIn("السطر 1", text)
        self.assertIn("اطبع(غير_موجود)", text)  # السطر العربي الأصلي
        self.assertIn("خطأ_اسم: الاسم 'غير_موجود' غير معرّف", text)
        self.assertNotIn(os.path.join(ROOT, "afaa"), text)

    def test_type_error_message(self):
        text = self.error_text('١ + "أ"\n')
        self.assertIn("خطأ_نوع", text)
        self.assertIn("'عدد_صحيح' و 'نص'", text)

    def test_zero_division(self):
        self.assertIn("خطأ_قسمة_على_صفر: القسمة على صفر",
                      self.error_text("١ / ٠\n"))

    def test_syntax_error_shows_arabic_line(self):
        text = self.error_text("إذا صح\n    مرر\n")
        self.assertIn("خطأ_صياغة", text)
        self.assertIn("إذا صح", text)


class ImportAndCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        os.makedirs(os.path.join(self.dir, "حزمة"))
        self.write("وحدة.af", "دالة ضاعف(س):\n    أرجع س * ٢\n")
        self.write("حزمة/__init__.af", "ثابت = ٤٢\n")
        self.write("حزمة/فرعية.af", "من . استورد ثابت\nقيمة = ثابت + ١\n")
        self.write("رئيسي.af", textwrap.dedent("""\
            استورد وحدة
            من حزمة.فرعية استورد قيمة
            استورد نظام
            اطبع(وحدة.ضاعف(٢١)، قيمة، نظام.معاملات_التشغيل[١:])
            إذا __اسم__ == "__رئيسي__":
                اطبع("رئيسي")
            """))
        self.write("خطأ.af", "دالة ف():\n    أرجع ١ / ٠\nف()\n")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)

    def cli(self, *args, stdin=None):
        env = dict(os.environ, PYTHONPATH=ROOT, PYTHONIOENCODING="utf-8")
        return subprocess.run(
            [sys.executable, "-m", "afaa", *args], cwd=self.dir, env=env,
            input=stdin, capture_output=True, text=True, encoding="utf-8")

    def test_run_file_with_imports(self):
        result = self.cli("رئيسي.af", "أ")
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout, "42 43 ['أ']\nرئيسي\n")

    def test_run_module(self):
        result = self.cli("-m", "رئيسي")
        self.assertEqual(result.stdout.splitlines()[-1], "رئيسي")

    def test_command(self):
        self.assertEqual(self.cli("-c", "اطبع(٢ ** ١٠)").stdout, "1024\n")

    def test_error_exit_code_and_traceback(self):
        result = self.cli("خطأ.af")
        self.assertEqual(result.returncode, 1)
        self.assertIn('السطر 2، في ف', result.stderr)
        self.assertIn("أرجع ١ / ٠", result.stderr)
        self.assertIn("خطأ_قسمة_على_صفر", result.stderr)

    def test_translate_command(self):
        result = self.cli("--translate", "وحدة.af")
        self.assertEqual(result.stdout, "def ضاعف(س):\n    return س * 2\n")

    def test_repl(self):
        result = self.cli(stdin="س = ٥\nإذا س > ٣:\n    اطبع('كبير')\n\nس * ٢\nص\n")
        self.assertIn("كبير", result.stdout)
        self.assertIn("10", result.stdout)
        self.assertIn("الاسم 'ص' غير معرّف", result.stdout + result.stderr)

    def test_examples_run(self):
        examples = os.path.join(ROOT, "examples")
        for name in sorted(os.listdir(examples)):
            if name.endswith(".af"):
                with self.subTest(name=name):
                    result = self.cli(os.path.join(examples, name), stdin="50\n" * 10)
                    self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
