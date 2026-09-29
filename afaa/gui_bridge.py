"""الجسر بين مكتبة «واجهات» والصفحة التي تعرض التطبيق.

المكتبة (afaa/lib/واجهات.af) لا تعرف شيئًا عن المتصفح: كل ما تفعله أنها تضيف
«عمليات» إلى طابور هذا الجسر (إنشاء عنصر، تغيير خاصية، رسم...). عامل الخلفية
في المتصفح (web/src/worker.js) يرسل الطابور إلى الصفحة بعد كل تنفيذ، ويعيد
أحداث المستخدم (ضغطة، كتابة، مؤقت) عبر ``dispatch``.
"""

import inspect
import json

__all__ = [
    "enabled", "active", "new_id", "emit", "emit_draw", "register", "unregister",
    "flush", "dispatch", "reset", "call_handler",
]

# يُفعَّل في المتصفح (أو في الاختبارات). خارجه تُرفع رسالة توضيحية.
enabled = False
# هل أنشأ البرنامج واجهة؟ (فيبقى التطبيق يعمل بعد انتهاء الشيفرة)
active = False

_queue = []
_registry = {}
_next_id = 0

NOT_AVAILABLE = (
    "مكتبة «واجهات» تعمل في المتصفح فقط.\n"
    "شغّل برنامجك في ساحة أفعى، أو استخدم الأمر:  afaa --web ملفك.af"
)


def new_id():
    global _next_id, active
    if not enabled:
        raise RuntimeError(NOT_AVAILABLE)
    active = True
    _next_id += 1
    return _next_id


def _snapshot(value):
    # نسخة مستقلة: تغيير خصائص العنصر لاحقا لا يغيّر عملية تنتظر الإرسال
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def emit(op):
    _queue.append(_snapshot(op))


def emit_draw(widget_id, command):
    """يضم أوامر الرسم المتتالية للوحة نفسها في عملية واحدة."""
    last = _queue[-1] if _queue else None
    if last and last.get("op") == "draw" and last.get("id") == widget_id:
        last["cmds"].append(_snapshot(command))
    else:
        _queue.append({"op": "draw", "id": widget_id, "cmds": [_snapshot(command)]})


def register(widget_id, obj):
    _registry[widget_id] = obj


def unregister(widget_id):
    _registry.pop(widget_id, None)


def flush():
    """يعيد العمليات المتراكمة بصيغة JSON (أو None إن لم يوجد شيء)."""
    if not _queue:
        return None
    ops = json.dumps(_queue, ensure_ascii=False, default=str)
    _queue.clear()
    return ops


def reset():
    """يبدأ من جديد: يُستدعى قبل كل تشغيل."""
    global active, _next_id
    _queue.clear()
    _registry.clear()
    _next_id = 0
    active = False
    emit({"op": "reset"})


def call_handler(func, *args):
    """يستدعي دالة المستخدم بعدد المعاملات الذي تقبله (صفر أو أكثر)."""
    try:
        params = inspect.signature(func).parameters.values()
    except (TypeError, ValueError):
        return func(*args)
    if any(p.kind is p.VAR_POSITIONAL for p in params):
        return func(*args)
    count = sum(1 for p in params
                if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD))
    return func(*args[:count])


def dispatch(widget_id, name, data_json):
    """يوصل حدثًا من الصفحة إلى العنصر المعني."""
    obj = _registry.get(int(widget_id))
    if obj is None:
        return
    data = json.loads(data_json) if data_json else None
    getattr(obj, "_عالج_حدث")(name, data)
