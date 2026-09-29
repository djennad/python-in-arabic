"""اختبارات مكتبة «واجهات» عبر الجسر (دون متصفح)."""

import contextlib
import io
import json
import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from afaa import gui_bridge, run_source  # noqa: E402


class GuiTestCase(unittest.TestCase):
    def setUp(self):
        gui_bridge.enabled = True
        gui_bridge.reset()
        gui_bridge.flush()

    def tearDown(self):
        gui_bridge.enabled = False
        gui_bridge.reset()
        gui_bridge.flush()

    def run_app(self, code):
        # في مجلد مؤقت: البرامج التي تنشئ قواعد بيانات لا تترك ملفات في المستودع
        out = io.StringIO()
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as folder:
            os.chdir(folder)
            try:
                with contextlib.redirect_stdout(out):
                    namespace = run_source(textwrap.dedent(code), module_name="__afaa_gui_test__")
            finally:
                os.chdir(previous)
        self.output = out.getvalue()
        return namespace

    def ops(self):
        raw = gui_bridge.flush()
        return json.loads(raw) if raw else []

    def event(self, widget_id, name, data=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gui_bridge.dispatch(widget_id, name, json.dumps(data))
        self.output += out.getvalue()
        return self.ops()


class WidgetTests(GuiTestCase):
    def test_counter_app(self):
        ns = self.run_app("""
            من واجهات استورد *
            عنوان_الصفحة("عدّاد")
            العدد = تسمية("٠")
            دالة زد():
                العدد.النص = نص(عدد_صحيح(العدد.النص) + ١)
            ز = زر("زد"، عند_الضغط=زد)
        """)
        ops = self.ops()
        self.assertTrue(gui_bridge.active)
        self.assertEqual(ops[0], {"op": "page", "props": {"title": "عدّاد"}})
        label, button = ops[1], ops[2]
        self.assertEqual((label["kind"], label["props"]["text"]), ("label", "٠"))
        self.assertEqual((button["kind"], button["props"]["text"]), ("button", "زد"))
        self.assertEqual(button["props"]["variant"], "primary")

        ops = self.event(button["id"], "click")
        self.assertEqual(ops, [{"op": "set", "id": label["id"], "props": {"text": "1"}}])
        self.event(button["id"], "click")
        self.assertEqual(ns["العدد"].النص, "2")

    def test_handler_arity(self):
        self.run_app("""
            من واجهات استورد *
            زر("أ"، عند_الضغط=لامدا: اطبع("بلا معطيات"))
            زر("ب"، عند_الضغط=لامدا ز: اطبع("الزر:"، ز.النص))
            لكل ع في ["ج"]:
                زر(ع، عند_الضغط=لامدا ع=ع: اطبع("التقاط:"، ع))
        """)
        a, b, c = self.ops()
        self.event(a["id"], "click")
        self.event(b["id"], "click")
        self.event(c["id"], "click")
        self.assertEqual(self.output, "بلا معطيات\nالزر: ب\nالتقاط: ج\n")

    def test_inputs_sync_values(self):
        ns = self.run_app("""
            من واجهات استورد *
            الأسماء = []
            حقل_الاسم = حقل_نص(تلميح="اسمك"، عند_الإرسال=لامدا ق: الأسماء.أضف(ق))
            عدد_ = حقل_عدد(٥، الأدنى=٠)
            مربع = مربع_اختيار("موافق")
            قائمة_ = قائمة_منسدلة(["أحمر"، "أزرق"])
            منزلق_ = منزلق(٠، ١٠، عند_التغيير=لامدا ق: اطبع("القيمة", ق))
        """)
        text, number, check, select, slider = self.ops()
        self.assertEqual(text["props"]["placeholder"], "اسمك")
        self.assertEqual(select["props"]["value"], "أحمر")

        self.event(text["id"], "change", "سارة")
        self.event(text["id"], "submit", "سارة")
        self.assertEqual(ns["الأسماء"], ["سارة"])
        self.assertEqual(ns["حقل_الاسم"].القيمة, "سارة")

        self.event(number["id"], "change", "7.5")
        self.assertEqual(ns["عدد_"].القيمة, 7.5)
        self.event(number["id"], "change", "8")
        self.assertEqual(ns["عدد_"].القيمة, 8)
        self.event(number["id"], "change", "")
        self.assertIsNone(ns["عدد_"].القيمة)

        self.event(check["id"], "change", True)
        self.assertIs(ns["مربع"].القيمة, True)
        self.event(select["id"], "change", "أزرق")
        self.assertEqual(ns["قائمة_"].القيمة, "أزرق")
        self.event(slider["id"], "change", "3")
        self.assertIn("القيمة 3", self.output)

    def test_setting_value_emits_update(self):
        self.run_app("""
            من واجهات استورد *
            ح = حقل_نص()
            ح.القيمة = "جديد"
            ح.أخف()
            ح.نسق(اللون="أحمر"، الحجم=٢٠، المحاذاة="وسط")
        """)
        create, value, hide, style = self.ops()
        self.assertEqual(value["props"], {"value": "جديد"})
        self.assertEqual(hide["props"], {"visible": False})
        self.assertEqual(style["props"]["style"],
                         {"color": "#dc2626", "fontSize": 20, "align": "center"})

    def test_containers_and_nesting(self):
        self.run_app("""
            من واجهات استورد *
            مع بطاقة("النموذج") باسم ب:
                مع أفقي():
                    زر("١")
                    زر("٢")
                تسمية("داخل البطاقة")
            تسمية("خارج")
            ب.امسح()
        """)
        ops = self.ops()
        card, row, b1, b2, inner, outer, clear = ops
        self.assertEqual((card["kind"], card["parent"], card["props"]["title"]), ("card", None, "النموذج"))
        self.assertEqual((row["kind"], row["parent"]), ("row", card["id"]))
        self.assertEqual(b1["parent"], row["id"])
        self.assertEqual(inner["parent"], card["id"])
        self.assertIsNone(outer["parent"])
        self.assertEqual(clear, {"op": "clear", "id": card["id"]})
        # العناصر المحذوفة لم تعد تستقبل أحداثا
        self.assertEqual(self.event(b1["id"], "click"), [])

    def test_table(self):
        self.run_app("""
            من واجهات استورد *
            ج = جدول(["الاسم"، "العمر"]، [["علي"، ٣٠]])
            ج.أضف_صفا("سارة"، ٢٨)
        """)
        create, update = self.ops()
        self.assertEqual(create["props"]["rows"], [["علي", "30"]])
        self.assertEqual(update["props"]["rows"], [["علي", "30"], ["سارة", "28"]])

    def test_table_from_query_rows(self):
        self.run_app("""
            من واجهات استورد *
            من قواعد_البيانات استورد قاعدة_بيانات
            ق = قاعدة_بيانات()
            ق.نفذ("أنشئ جدول ط (الاسم نص، العمر عدد_صحيح، الهاتف نص)")
            ق.نفذ("أدخل إلى ط (الاسم، العمر) القيم ('أحمد'، ١٦)")
            ج = جدول(ق.استعلم("اختر * من ط"))
            ق.نفذ("أدخل إلى ط (الاسم، العمر) القيم ('سارة'، ١٥)")
            ج.اعرض(ق.استعلم("اختر * من ط رتب حسب العمر"))
            ج.أضف_صفا({"الاسم": "يوسف"، "العمر": ١٧})
            فارغ_ = جدول([])
            فارغ_.اعرض(ق.استعلم("اختر الاسم من ط"))
        """)
        create, show, add, empty, columns, rows = self.ops()
        self.assertEqual(create["props"]["columns"], ["الاسم", "العمر", "الهاتف"])
        self.assertEqual(create["props"]["rows"], [["أحمد", "16", ""]])
        self.assertEqual(show["props"]["rows"], [["سارة", "15", ""], ["أحمد", "16", ""]])
        self.assertEqual(add["props"]["rows"][-1], ["يوسف", "17", ""])
        self.assertEqual(columns["props"], {"columns": ["الاسم"]})
        self.assertEqual(rows["props"]["rows"], [["أحمد"], ["سارة"]])

    def test_table_from_orm_models(self):
        self.run_app("""
            من واجهات استورد *
            من قواعد_البيانات استورد *
            ق = قاعدة_بيانات()
            صنف كتاب(نموذج):
                العنوان = عمود_نص()
                السنة = عمود_عدد_صحيح()
            ق.أنشئ_جداول(كتاب)
            كتاب.أنشئ(العنوان="كليلة ودمنة"، السنة=٧٥٠)
            ك = كتاب.أنشئ(العنوان="المقدمة"، السنة=١٣٧٧)
            ج = جدول(كتاب.رتب(كتاب.السنة))
            ج.اعرض(كتاب.حيث(كتاب.السنة > ١٠٠٠))
            ج.أضف_صفا(ك)
            ف = جدول(["العنوان"]، كتاب.الكل())
            فارغ_ = جدول(كتاب.حيث(كتاب.السنة > ٥٠٠٠))
        """)
        create, show, add, named, empty = self.ops()
        self.assertEqual(create["props"]["columns"], ["المعرف", "العنوان", "السنة"])
        self.assertEqual(create["props"]["rows"], [["1", "كليلة ودمنة", "750"], ["2", "المقدمة", "1377"]])
        self.assertEqual(show["props"]["rows"], [["2", "المقدمة", "1377"]])
        self.assertEqual(add["props"]["rows"][-1], ["2", "المقدمة", "1377"])
        self.assertEqual(named["props"]["rows"], [["كليلة ودمنة"], ["المقدمة"]])
        self.assertEqual(empty["props"], {"columns": [], "rows": []})

    def test_remove(self):
        self.run_app("""
            من واجهات استورد *
            ت = تسمية("مؤقتة")
            ت.أزل()
        """)
        create, remove = self.ops()
        self.assertEqual(remove, {"op": "remove", "id": create["id"]})


class CanvasTests(GuiTestCase):
    def test_drawing_commands_are_batched(self):
        self.run_app("""
            من واجهات استورد *
            ل = لوحة_رسم(٢٠٠، ١٠٠، الخلفية="أسود")
            ل.ارسم_خطا(٠، ٠، ١٠، ١٠، "أحمر")
            ل.ارسم_دائرة(٥٠، ٥٠، ٢٠، التعبئة="أزرق")
            ل.ارسم_نصا("مرحبا"، ١٠٠، ٥٠)
        """)
        create, draw = self.ops()
        self.assertEqual(create["props"], {"width": 200, "height": 100, "background": "#111827"})
        self.assertEqual(draw["op"], "draw")
        self.assertEqual([c[0] for c in draw["cmds"]], ["line", "circle", "text"])
        self.assertEqual(draw["cmds"][0], ["line", 0, 0, 10, 10, "#dc2626", 2])

    def test_canvas_click(self):
        self.run_app("""
            من واجهات استورد *
            دالة ضغط(س، ص):
                اطبع("ضغطة", س, ص)
            لوحة_رسم(عند_الضغط=ضغط)
        """)
        (canvas,) = self.ops()
        self.event(canvas["id"], "click", {"x": 12, "y": 34})
        self.assertEqual(self.output, "ضغطة 12 34\n")

    def test_turtle_draws_square(self):
        self.run_app("""
            من واجهات استورد *
            س = سلحفاة_رسم()
            لكل _ في مدى(٤):
                س.تقدم(١٠٠)
                س.يسار(٩٠)
        """)
        canvas, draw = self.ops()
        lines = [[round(v) for v in c[1:5]] for c in draw["cmds"]]
        self.assertEqual(lines, [[200, 200, 300, 200], [300, 200, 300, 100],
                                 [300, 100, 200, 100], [200, 100, 200, 200]])


class TimerAndPageTests(GuiTestCase):
    def test_repeating_timer(self):
        ns = self.run_app("""
            من واجهات استورد *
            العداد = [٠]
            دالة نبضة():
                العداد[٠] += ١
                إذا العداد[٠] == ٢:
                    م.أوقف()
            م = كرر_كل(٠٫٥، نبضة)
        """)
        (timer,) = self.ops()
        self.assertEqual(timer, {"op": "timer", "id": timer["id"], "ms": 500, "repeat": True})
        self.event(timer["id"], "tick")
        self.assertEqual(self.event(timer["id"], "tick"),
                         [{"op": "cancel-timer", "id": timer["id"]}])
        self.event(timer["id"], "tick")  # أُوقف: لا أثر
        self.assertEqual(ns["العداد"], [2])

    def test_one_shot_timer(self):
        ns = self.run_app("""
            من واجهات استورد *
            نتيجة = []
            بعد_مدة(١، لامدا: نتيجة.أضف("تم"))
        """)
        (timer,) = self.ops()
        self.assertFalse(timer["repeat"])
        self.event(timer["id"], "tick")
        self.event(timer["id"], "tick")
        self.assertEqual(ns["نتيجة"], ["تم"])

    def test_toast_and_clear_page(self):
        self.run_app("""
            من واجهات استورد *
            ز = زر("أ")
            تنبيه("تم الحفظ"، "نجاح")
            امسح_الصفحة()
        """)
        button, toast, clear = self.ops()
        self.assertEqual(toast, {"op": "toast", "text": "تم الحفظ", "kind": "success"})
        self.assertEqual(clear, {"op": "clear", "id": None})
        self.assertEqual(self.event(button["id"], "click"), [])

    def test_reset_between_runs(self):
        self.run_app("من واجهات استورد *\nزر('أ')\n")
        gui_bridge.reset()
        self.assertEqual(self.ops(), [{"op": "reset"}])
        self.assertFalse(gui_bridge.active)


class ExampleTests(GuiTestCase):
    def test_gui_examples_build_their_ui(self):
        folder = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "examples", "gui")
        for name in sorted(os.listdir(folder)):
            with self.subTest(example=name):
                gui_bridge.reset()
                gui_bridge.flush()
                with open(os.path.join(folder, name), encoding="utf-8") as fh:
                    self.run_app(fh.read())
                created = [op for op in self.ops() if op["op"] == "create"]
                self.assertGreater(len(created), 3)

    def test_counter_example_clicks(self):
        folder = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "examples", "gui")
        with open(os.path.join(folder, "counter.af"), encoding="utf-8") as fh:
            self.run_app(fh.read())
        buttons = {op["props"]["text"]: op["id"] for op in self.ops()
                   if op.get("kind") == "button"}
        self.event(buttons["+ زيادة"], "click")
        ops = self.event(buttons["+ زيادة"], "click")
        self.assertIn({"text": "2"}, [op["props"] for op in ops])


class WebLinkTests(unittest.TestCase):
    def test_web_link_round_trip(self):
        import base64
        import zlib
        from afaa.cli import web_link
        code = "اطبع(«مرحبا»)\n"
        link = web_link(code, base="https://example.com/ساحة/")
        self.assertTrue(link.startswith("https://example.com/ساحة/app.html#code=z"))
        token = link.split("#code=z", 1)[1]
        data = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        self.assertEqual(zlib.decompress(data, -15).decode("utf-8"), code)
        self.assertTrue(web_link(code, "", base="https://x.org").startswith("https://x.org/#code="))


class OutsideBrowserTests(unittest.TestCase):
    def test_clear_error_outside_browser(self):
        gui_bridge.enabled = False
        with self.assertRaises(RuntimeError) as ctx:
            run_source("من واجهات استورد *\nزر('أ')\n", module_name="__afaa_gui_test__")
        self.assertIn("afaa --web", str(ctx.exception))

    def test_no_public_name_shadows_builtins(self):
        import builtins
        import importlib
        import afaa
        afaa.install()
        module = importlib.import_module("واجهات")
        public = [n for n in dir(module) if not n.startswith("_")]
        self.assertEqual([n for n in public if hasattr(builtins, n)], [])


if __name__ == "__main__":
    unittest.main()
