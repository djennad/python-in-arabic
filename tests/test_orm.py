"""اختبارات النماذج (ORM) في مكتبة «قواعد_البيانات»."""

import contextlib
import io
import os
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from afaa import run_source  # noqa: E402
from afaa.errors import format_exception  # noqa: E402

MODELS = """
من قواعد_البيانات استورد *

ق = قاعدة_بيانات("مدرسة")

صنف طالب(نموذج):
    اسم_الجدول = "الطلاب"
    الاسم = عمود_نص(مطلوب=صح، فريد=صح)
    العمر = عمود_عدد_صحيح(افتراضي=١٥)
    المدينة = عمود_نص(فهرس=صح)
    ناجح = عمود_منطقي(افتراضي=خطأ)

صنف درجة(نموذج):
    الطالب = عمود_مرجع(طالب)
    المادة = عمود_نص()
    العلامة = عمود_عدد_عشري()

ق.أنشئ_جداول(طالب، درجة)
طالب.أنشئ_عدة([
    {"الاسم": "أحمد"، "العمر": ١٦، "المدينة": "الجزائر"}،
    {"الاسم": "سارة"، "العمر": ١٥، "المدينة": "وهران"}،
    {"الاسم": "يوسف"، "العمر": ١٧، "المدينة": "الجزائر"}،
    {"الاسم": "مريم"، "المدينة": "قسنطينة"}،
])
"""


class OrmTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def run_afaa(self, code, models=True, folder=None):
        source = (MODELS if models else "") + textwrap.dedent(code)
        out = io.StringIO()
        previous = os.getcwd()
        os.chdir(folder or self.tmp.name)
        try:
            with contextlib.redirect_stdout(out):
                run_source(source, module_name="__afaa_orm_test__")
        finally:
            os.chdir(previous)
        return out.getvalue().splitlines()

    def error(self, code):
        # كل فحص خطأ في مجلد جديد: لا تتأثر البيانات الأولية بتشغيل سابق
        with tempfile.TemporaryDirectory() as folder:
            try:
                self.run_afaa(code, folder=folder)
            except BaseException as exc:  # noqa: BLE001
                return format_exception(exc)
        self.fail("لم يحدث خطأ")


class QueryTests(OrmTestCase):
    def test_create_defaults_and_get(self):
        self.assertEqual(self.run_afaa("""
            اطبع(طالب.عد())
            م = طالب.احصل(الاسم="مريم")
            اطبع(م.العمر، م.ناجح، م.المعرف)
            اطبع(طالب.احصل(١).الاسم، طالب.احصل(٩٩))
            اطبع(طالب.أول().الاسم)
        """), ["4", "15 False 4", "أحمد None", "أحمد"])

    def test_filters_operators_and_order(self):
        self.assertEqual(self.run_afaa("""
            اطبع([ط.الاسم لكل ط في طالب.حيث(طالب.العمر > ١٥).رتب(-طالب.العمر)])
            اطبع([ط.الاسم لكل ط في طالب.حيث(المدينة="الجزائر").رتب("الاسم")])
            اطبع([ط.الاسم لكل ط في طالب.حيث((طالب.العمر >= ١٧) | (طالب.المدينة == "وهران")).رتب(طالب.المعرف)])
            اطبع([ط.الاسم لكل ط في طالب.حيث(~طالب.المدينة.ضمن(["الجزائر"، "وهران"]))])
            اطبع([ط.الاسم لكل ط في طالب.حيث(طالب.العمر.بين(١٥، ١٦)، طالب.الاسم.يحتوي("م")).رتب(طالب.الاسم.تنازليا())])
            اطبع([ط.الاسم لكل ط في طالب.حيث(طالب.الاسم.يبدأ_ب("س"))])
            اطبع([ط.الاسم لكل ط في طالب.رتب("-العمر"، "الاسم").حد(٢).تخطى(١)])
        """), [
            "['يوسف', 'أحمد']",
            "['أحمد', 'يوسف']",
            "['سارة', 'يوسف']",
            "['مريم']",
            "['مريم', 'أحمد']",
            "['سارة']",
            "['أحمد', 'سارة']",
        ])

    def test_count_exists_aggregates(self):
        self.assertEqual(self.run_afaa("""
            س = طالب.حيث(المدينة="الجزائر")
            اطبع(س.عد()، طول(س)، س.موجود()، طالب.حيث(المدينة="عنابة").موجود())
            اطبع(طالب.استعلام().مجموع(طالب.العمر)، طالب.استعلام().متوسط(طالب.العمر))
            اطبع(س.أكبر(طالب.العمر)، س.أصغر(طالب.العمر))
            اطبع(طالب.رتب(طالب.العمر).حد(٢).عد())
        """), ["2 2 True False", "63 15.75", "17 16", "2"])

    def test_save_update_remove(self):
        self.assertEqual(self.run_afaa("""
            أ = طالب.احصل(الاسم="أحمد")
            أ.العمر = ٢٠
            أ.ناجح = صح
            أ.احفظ()
            اطبع(طالب.احصل(أ.المعرف).العمر، طالب.احصل(أ.المعرف).ناجح)
            ج = طالب(الاسم="ليلى")
            اطبع(ج.المعرف)
            ج.احفظ()
            اطبع(ج.المعرف، طالب.عد())
            اطبع(طالب.حيث(المدينة="الجزائر").حدث(ناجح=صح، العمر=١٨))
            اطبع([ط.العمر لكل ط في طالب.حيث(ناجح=صح)])
            ج.أزل()
            اطبع(ج.المعرف، طالب.عد())
            اطبع(طالب.حيث(طالب.المدينة.فارغ()).أزل()، طالب.عد())
            أ.العمر = ٥٠
            اطبع(أ.أعد_التحميل().العمر)
        """), ["20 True", "None", "5 5", "2", "[18, 18]", "None 4", "0 4", "18"])

    def test_references_and_cascade(self):
        self.assertEqual(self.run_afaa("""
            أ = طالب.احصل(الاسم="أحمد")
            درجة.أنشئ(الطالب=أ، المادة="رياضيات"، العلامة=١٧٫٥)
            درجة.أنشئ(الطالب=أ.المعرف، المادة="فيزياء"، العلامة=١٥)
            د = درجة.أول()
            اطبع(د.الطالب.الاسم، د.الطالب == أ، د.كقاموس())
            اطبع(درجة.حيث(درجة.الطالب == أ).متوسط(درجة.العلامة))
            أ.أزل()
            اطبع(درجة.عد())
        """), [
            "أحمد True {'المعرف': 1, 'الطالب': 1, 'المادة': 'رياضيات', 'العلامة': 17.5}",
            "16.25",
            "0",
        ])

    def test_dates(self):
        self.assertEqual(self.run_afaa("""
            استورد datetime
            صنف حدث_(نموذج):
                العنوان = عمود_نص()
                اليوم = عمود_تاريخ()
                وقت_الإنشاء = عمود_تاريخ(تلقائي=صح)
            ق.أنشئ_جداول(حدث_)
            ح = حدث_.أنشئ(العنوان="امتحان"، اليوم=datetime.date(2026، ٦، ١٥))
            ح = حدث_.احصل(ح.المعرف)
            اطبع(ح.اليوم، نوع(ح.اليوم).__اسم__، نوع(ح.وقت_الإنشاء).__اسم__)
            اطبع([ح.العنوان لكل ح في حدث_.حيث(حدث_.اليوم > datetime.date(2026، ١، ١))])
        """), ["2026-06-15 date datetime", "['امتحان']"])

    def test_tables_persist_and_new_columns_are_added(self):
        self.run_afaa("")
        self.assertEqual(self.run_afaa("""
            من قواعد_البيانات استورد *
            ق = قاعدة_بيانات("مدرسة")
            صنف طالب(نموذج):
                اسم_الجدول = "الطلاب"
                الاسم = عمود_نص()
                الهاتف = عمود_نص()
            ق.أنشئ_جداول(طالب)
            اطبع(طالب.عد()، ق.أعمدة("الطلاب")[-١])
            ي = طالب.احصل(الاسم="يوسف")
            ي.الهاتف = "0555"
            ي.احفظ()
            اطبع(طالب.احصل(الاسم="يوسف").الهاتف)
        """, models=False), ["4 الهاتف", "0555"])

    def test_inheritance_and_repr(self):
        self.assertEqual(self.run_afaa("""
            صنف شخص(نموذج):
                الاسم = عمود_نص()
            صنف معلم(شخص):
                المادة = عمود_نص()
            ق.أنشئ_جداول(معلم)
            م = معلم.أنشئ(الاسم="خالد"، المادة="العربية")
            اطبع(م)
            اطبع(ق.أعمدة("معلم"))
            اطبع(طالب.حيث(طالب.العمر > ١٦))
        """), [
            "<معلم المعرف=1 الاسم='خالد' المادة='العربية'>",
            "['المعرف', 'الاسم', 'المادة']",
            "<استعلام SELECT * FROM \"الطلاب\" WHERE (\"العمر\" > ?) [16]>",
        ])


class OrmErrorTests(OrmTestCase):
    def test_unique_violation_is_arabic_without_generated_sql(self):
        text = self.error('طالب.أنشئ(الاسم="أحمد")\n')
        self.assertIn("خطأ_قاعدة_بيانات: القيمة مكررة في «الطلاب.الاسم»", text)
        self.assertNotIn("INSERT", text)

    def test_python_and_or_give_helpful_error(self):
        text = self.error("طالب.حيث(طالب.العمر > ١ و طالب.العمر < ٥)\n")
        self.assertIn("استخدم & و | و ~", text)

    def test_unknown_column(self):
        self.assertIn("لا يوجد عمود باسم «اللقب» في النموذج «طالب»",
                      self.error('طالب(اللقب="س")\n'))
        self.assertIn("لا يوجد عمود باسم «اللقب»", self.error('طالب.حيث(اللقب="س").الكل()\n'))

    def test_unbound_model(self):
        text = self.error("صنف كتاب(نموذج):\n    العنوان = عمود_نص()\nكتاب.الكل()\n")
        self.assertIn("غير مربوط بقاعدة بيانات", text)
        self.assertIn("ق.أنشئ_جداول(كتاب)", text)

    def test_required_column(self):
        text = self.error("طالب.أنشئ(العمر=١٠)\n")
        self.assertIn("لا يقبل قيمة فارغة", text)


if __name__ == "__main__":
    unittest.main()
