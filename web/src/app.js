// صفحة التطبيق المستقل: تشغّل برنامج أفعى وتعرض واجهته على كامل الصفحة، دون المحرر.
//
// مصدر البرنامج بالترتيب:
//   1. الرابط: app.html#code=...   (زر «نافذة مستقلة» و«رابط التطبيق»)
//   2. الملف program.af بجانب الصفحة (المواقع المُصدَّرة)
// ويقرأ config.json (إن وُجد) لمعرفة رابط المحرر في زر «عرض الشيفرة».

import { OutputConsole } from "./console.js";
import { Runtime } from "./runtime.js";
import { codeFromHash, encodeCode } from "./share.js";
import { UiRenderer } from "./ui.js";

const $ = (id) => document.getElementById(id);

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* التخزين غير متاح */ }
  },
};

let toastTimer = null;
function showToast(text, kind = "info") {
  const toast = $("toast");
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function setLoading(text) {
  if (text == null) {
    $("loading").hidden = true;
    return;
  }
  $("loading").hidden = false;
  $("loading-text").textContent = text;
}

// ---------------------------------------------------------------------------
// المخرجات: تظهر في الصفحة إن لم يكن للبرنامج واجهة، وإلا في «السجل»
// ---------------------------------------------------------------------------
const mainOutput = new OutputConsole($("app-output"));
const log = new OutputConsole($("app-log"));
let hasUi = false;
let errorText = "";

function write(text, cls) {
  log.append(text, cls);
  if (!hasUi) mainOutput.append(text, cls);
  $("log-toggle").hidden = !hasUi;
}

function showError(text) {
  errorText += text;
  $("app-error-text").textContent = errorText;
  $("app-error").hidden = false;
}

$("app-error-close").addEventListener("click", () => {
  $("app-error").hidden = true;
  errorText = "";
});

$("log-toggle").addEventListener("click", () => {
  log.flush();
  $("app-log").hidden = !$("app-log").hidden;
});

// ---------------------------------------------------------------------------
// الواجهة والتشغيل
// ---------------------------------------------------------------------------
const ui = new UiRenderer($("ui-root"), {
  sendEvent: (id, name, data, mode) => runtime.sendEvent(id, name, data, mode),
  onTitle: (title) => { document.title = title; },
  onToast: (text, kind) => showToast(text, kind),
  onCreate: () => {
    if (hasUi) return;
    hasUi = true;
    $("app-output").hidden = true;
    $("log-toggle").hidden = log.empty;
  },
});

let program = null;

const runtime = new Runtime({
  onStatus: (text) => setLoading(text),
  onReady: () => {
    // بعد «إيقاف» لا نعيد التشغيل تلقائيًا
    if (program == null) return;
    setLoading("جارٍ تشغيل التطبيق…");
    runtime.run(program);
  },
  onFatal: (text) => {
    setLoading(null);
    showError(`تعذّر تحميل بيئة التشغيل: ${text}\n`);
  },
  onStdout: (text) => write(text),
  onStderr: (text) => {
    write(text, "stderr");
    showError(text);
  },
  onInputRequest: () => {
    setLoading(null);
    mainOutput.flush();
    $("app-output").hidden = false;
    $("input-row").hidden = false;
    $("input").value = "";
    $("input").focus();
  },
  onUiOps: (ops) => {
    setLoading(null);
    ui.apply(ops);
  },
  onUiError: () => {},
  onDone: () => {
    setLoading(null);
    if (!hasUi) $("app-output").hidden = false;
  },
});

$("input-row").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("input").value;
  mainOutput.append(text + "\n", "echo");
  $("input-row").hidden = true;
  runtime.sendInput(text);
});

$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  storage.set("afaa:theme", next);
});

// ---------------------------------------------------------------------------
// البدء
// ---------------------------------------------------------------------------
// يعيد { code, exported }: exported صحيح إن جاء البرنامج من program.af (موقع مُصدَّر)
async function loadProgram() {
  const fromLink = await codeFromHash().catch(() => null);
  if (fromLink != null) return { code: fromLink, exported: false };
  try {
    const response = await fetch("program.af", { cache: "no-cache" });
    if (response.ok) return { code: await response.text(), exported: true };
  } catch { /* لا يوجد ملف */ }
  return { code: null, exported: false };
}

// المحرر في الموقع نفسه، إلا في المواقع المُصدَّرة: رابطه في config.json
async function editorUrl(exported) {
  if (exported) {
    try {
      const response = await fetch("config.json", { cache: "no-cache" });
      if (response.ok) {
        const config = await response.json();
        if (config.editor) return new URL(config.editor, location.href);
      }
    } catch { /* لا توجد إعدادات */ }
  }
  return new URL("./", location.href);
}

const loaded = await loadProgram();
program = loaded.code;
if (program == null) {
  setLoading(null);
  showError("لا يوجد برنامج لتشغيله. افتح هذه الصفحة من ساحة أفعى، أو ضع ملف program.af بجانبها.\n");
} else {
  const editor = await editorUrl(loaded.exported);
  editor.hash = `code=${await encodeCode(program)}`;
  $("view-source").href = editor.href;
  runtime.start();
}
