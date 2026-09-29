// إدارة عامل الخلفية الذي يشغّل بايثون وأفعى. يستخدمه المحرر وصفحة التطبيق المستقل.

const INPUT_BYTES = 64 * 1024;
export const canInput = typeof SharedArrayBuffer === "function" && self.crossOriginIsolated;

export class Runtime {
  // handlers: onStatus, onReady, onFatal, onStdout, onStderr, onInputRequest,
  //           onUiOps, onUiError, onDone, onTranslated
  constructor(handlers) {
    this.handlers = handlers;
    this.worker = null;
    this.ready = false;
    this.running = false;   // الشيفرة الرئيسية قيد التنفيذ
    this.appLive = false;   // انتهت الشيفرة وبقي التطبيق ينتظر أحداث المستخدم
    this.translateId = 0;
    this.pending = new Map(); // أحداث أُرسلت ولم يُرد عليها بعد
  }

  start() {
    this.ready = false;
    this.running = false;
    this.appLive = false;
    this.pending.clear();
    // نسبة إلى الصفحة لا إلى هذا الملف: قد يُنقل عند البناء إلى مجلد chunks/
    this.worker = new Worker(new URL("worker.js", document.baseURI), { type: "module" });
    if (canInput) {
      this.inputBuffer = new SharedArrayBuffer(8 + INPUT_BYTES);
      this.worker.postMessage({ type: "input-buffer", buffer: this.inputBuffer });
    }
    this.worker.onmessage = (event) => this.onMessage(event.data);
    this.worker.onerror = (event) => this.handlers.onFatal?.(event.message || "خطأ غير معروف");
  }

  onMessage(message) {
    const h = this.handlers;
    switch (message.type) {
      case "status": h.onStatus?.(message.text); break;
      case "ready": this.ready = true; h.onReady?.(message.version); break;
      case "fatal": h.onFatal?.(message.text); break;
      case "stdout": h.onStdout?.(message.text); break;
      case "stderr": h.onStderr?.(message.text); break;
      case "input-request": h.onInputRequest?.(); break;
      case "ui-ops":
        h.onUiOps?.(message.ops);
        if (message.ack) this.acknowledge(message.ack);
        break;
      case "ui-error": h.onUiError?.(message.errorLine); break;
      case "done":
        this.running = false;
        this.appLive = Boolean(message.app);
        h.onDone?.(message);
        break;
      case "translated":
        if (message.id === this.translateId) h.onTranslated?.(message.python);
        break;
    }
  }

  run(code) {
    if (!this.ready || this.running) return false;
    this.running = true;
    this.appLive = false;
    this.pending.clear();
    this.worker.postMessage({ type: "run", code });
    return true;
  }

  // إيقاف فوري: ينهي العامل ويبدأ غيره (بايثون يُحمَّل من ذاكرة المتصفح)
  stop() {
    this.worker.terminate();
    this.start();
  }

  translate(code) {
    if (!this.ready) return;
    this.translateId += 1;
    this.worker.postMessage({ type: "translate", id: this.translateId, code });
  }

  sendInput(text) {
    const flag = new Int32Array(this.inputBuffer, 0, 2);
    let bytes = new TextEncoder().encode(text);
    if (bytes.length > INPUT_BYTES) bytes = bytes.slice(0, INPUT_BYTES);
    new Uint8Array(this.inputBuffer, 8, INPUT_BYTES).set(bytes);
    Atomics.store(flag, 1, bytes.length);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  }

  // mode: "queue" (كل حدث يصل، مثل الضغطات)
  //       "latest" (إن كان حدث سابق قيد المعالجة يُرسل آخر قيمة فقط بعده، مثل الكتابة)
  //       "drop" (يُتجاهل إن كان سابقه قيد المعالجة، مثل نبضات المؤقت)
  sendEvent(id, name, data = null, mode = "queue") {
    // العامل يعالج الرسائل بالترتيب: حدث يصل أثناء التشغيل يُعالج بعده
    if (!this.ready) return;
    const key = `${id}:${name}`;
    if (mode !== "queue" && this.pending.has(key)) {
      if (mode === "latest") this.pending.set(key, { data });
      return;
    }
    if (mode !== "queue") this.pending.set(key, null);
    this.worker.postMessage({ type: "ui-event", id, name, data });
  }

  acknowledge({ id, name }) {
    const key = `${id}:${name}`;
    const next = this.pending.get(key);
    this.pending.delete(key);
    if (next) this.sendEvent(id, name, next.data, "latest");
  }
}
