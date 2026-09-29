"""اختبارات «ستريمليت» بالعربية باستخدام أداة الاختبار في Streamlit نفسها (AppTest).

تُتخطى إن لم تكن مكتبة streamlit مثبتة.
"""

import os
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

try:
    from streamlit.testing.v1 import AppTest
except ImportError:  # pragma: no cover
    AppTest = None

from afaa.streamlit_runner import launcher_source  # noqa: E402


@unittest.skipIf(AppTest is None, "مكتبة streamlit غير مثبتة")
class ArabicStreamlitTests(unittest.TestCase):
    def app(self, code):
        folder = tempfile.mkdtemp()
        program = os.path.join(folder, "app.af")
        with open(program, "w", encoding="utf-8") as fh:
            fh.write(textwrap.dedent(code))
        launcher = os.path.join(folder, "launcher.py")
        with open(launcher, "w", encoding="utf-8") as fh:
            fh.write(launcher_source(program))
        return AppTest.from_file(launcher, default_timeout=60).run()

    def test_text_inputs_and_arabic_kwargs(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            ست.اضبط_الصفحة(عنوان_الصفحة="تجربة"، التخطيط="واسع")
            ست.عنوان("مرحبا")
            ست.ترويسة("قسم"، خط_تحت="أزرق")
            الاسم = ست.حقل_نص("الاسم"، القيمة="أحمد"، مساعدة="اكتب اسمك")
            العمر = ست.منزلق("العمر"، الأدنى=٥، الأقصى=٩٠، القيمة=٣٠)
            ست.اكتب(f"{الاسم}: {العمر}")
        """)
        self.assertFalse(at.exception)
        self.assertEqual(at.title[0].value, "مرحبا")
        self.assertEqual(at.header[0].value, "قسم")
        self.assertEqual((at.text_input[0].value, at.text_input[0].help), ("أحمد", "اكتب اسمك"))
        self.assertEqual((at.slider[0].value, at.slider[0].min, at.slider[0].max), (30, 5, 90))
        at.text_input[0].input("سارة").run()
        at.slider[0].set_value(40).run()
        self.assertEqual(at.markdown[0].value, "سارة: 40")

    def test_containers_session_state_and_forms(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            مع ست.الشريط_الجانبي:
                المدينة = ست.قائمة_منسدلة("المدينة"، ["الجزائر"، "وهران"])
            أ، ب = ست.أعمدة(٢)
            أ.مقياس("المدينة"، المدينة)
            إذا "العدد" ليس في ست.حالة_الجلسة:
                ست.حالة_الجلسة.العدد = ٠
            إذا ب.زر("زد"، نوع="أساسي"):
                ست.حالة_الجلسة.العدد += ١
            ست.اكتب(f"العدد {ست.حالة_الجلسة.العدد}")
            مع ست.استمارة("استمارة"):
                ملاحظة = ست.منطقة_نص("ملاحظة")
                أُرسلت = ست.زر_إرسال("أرسل")
            إذا أُرسلت:
                ست.نجاح(f"وصلت: {ملاحظة}")
            ل١، ل٢ = ست.ألسنة(["أول"، "ثاني"])
            ل٢.معلومة("في اللسان الثاني")
        """)
        self.assertFalse(at.exception)
        self.assertEqual(at.sidebar.selectbox[0].options, ["الجزائر", "وهران"])
        self.assertEqual(at.metric[0].value, "الجزائر")
        at.button[0].click().run()
        at.button[0].click().run()
        self.assertIn("العدد 2", [m.value for m in at.markdown])
        at.text_area[0].input("مرحبا").run()
        [b for b in at.button if b.label == "أرسل"][0].click().run()
        self.assertEqual(at.success[0].value, "وصلت: مرحبا")
        self.assertEqual(at.info[0].value, "في اللسان الثاني")

    def test_choices_and_data(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            الخيار = ست.اختيار_واحد("اللون"، ["أحمر"، "أزرق"]، الفهرس=١، أفقي=صح)
            الكل_ = ست.اختيار_متعدد("المواد"، ["رياضيات"، "فيزياء"]، افتراضي=["فيزياء"])
            العدد = ست.حقل_عدد("العدد"، الأدنى=٠، الأقصى=١٠، القيمة=٣)
            موافق = ست.مربع_اختيار("موافق")
            ست.جدول_بيانات({"الاسم": ["أحمد"، "سارة"]، "العمر": [١٦، ١٥]})
            ست.اكتب(الخيار، الكل_، العدد، موافق)
        """)
        self.assertFalse(at.exception)
        self.assertEqual(at.radio[0].value, "أزرق")
        self.assertEqual(at.multiselect[0].value, ["فيزياء"])
        self.assertEqual(at.number_input[0].value, 3)
        self.assertEqual(len(at.dataframe), 1)

    def test_errors_are_arabic(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            ست.عنوان("قبل الخطأ")
            اطبع(غير_معرف)
        """)
        self.assertEqual(at.title[0].value, "قبل الخطأ")
        self.assertEqual(at.error[0].value, "حدث خطأ في البرنامج")
        trace = at.code[0].value
        self.assertIn("خطأ_اسم: الاسم 'غير_معرف' غير معرّف", trace)
        self.assertIn("اطبع(غير_معرف)", trace)
        self.assertNotIn("streamlit", trace)

    def test_unknown_name_and_english_fallback(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            ست.الأصل.title("English API")
            ست.دالة_غير_موجودة()
        """)
        self.assertEqual(at.title[0].value, "English API")
        self.assertIn("لا يوجد في ستريمليت اسم «دالة_غير_موجودة»", at.code[0].value)

    def test_stop_and_rerun_are_not_errors(self):
        at = self.app("""
            استورد ستريمليت باسم ست
            ست.اكتب("قبل")
            ست.أوقف()
            ست.اكتب("بعد")
        """)
        self.assertFalse(at.error)
        self.assertEqual([m.value for m in at.markdown], ["قبل"])

    def test_examples_run(self):
        folder = os.path.join(ROOT, "examples", "streamlit")
        cwd = os.getcwd()
        os.chdir(tempfile.mkdtemp())   # قواعد البيانات التي تنشئها الأمثلة
        try:
            for name in sorted(os.listdir(folder)):
                with self.subTest(name=name), open(os.path.join(folder, name), encoding="utf-8") as fh:
                    at = self.app(fh.read())
                    self.assertFalse(at.exception)
                    self.assertFalse(at.error, [c.value for c in at.code])
        finally:
            os.chdir(cwd)

    def test_chat_example(self):
        with open(os.path.join(ROOT, "examples", "streamlit", "chat.af"), encoding="utf-8") as fh:
            at = self.app(fh.read())
        at.chat_input[0].set_value("٣ × ٧").run()
        at.run()
        self.assertIn("النتيجة: 21", [m.value for m in at.markdown])


class StreamlitPageTests(unittest.TestCase):
    def test_web_link_picks_streamlit_page(self):
        from afaa.cli import app_page, web_link
        self.assertEqual(app_page("# تطبيق\nاستورد ستريمليت باسم ست\n"), "streamlit.html")
        self.assertEqual(app_page("من ستريمليت استورد عنوان\n"), "streamlit.html")
        self.assertEqual(app_page("من واجهات استورد *\n"), "app.html")
        self.assertEqual(app_page("استورد ستريمليت_قديمة\n"), "app.html")
        self.assertTrue(web_link("ا", app_page("استورد ستريمليت\n"), "http://x/").startswith("http://x/streamlit.html#code="))


if __name__ == "__main__":
    unittest.main()
