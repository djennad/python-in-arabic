// ساحة أفعى: المحرر وواجهة التشغيل.

import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, Decoration, rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history as editHistory, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle, syntaxHighlighting, bracketMatching, foldGutter, indentOnInput,
} from "@codemirror/language";
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";

import { afaa } from "./afaa-lang.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "afaa:code";

const DEFAULT_CODE = `# مرحبا بك في ساحة أفعى!
# اكتب برنامجك بالعربية ثم اضغط «تشغيل» أو Ctrl+Enter

دالة تحية(اسم):
    أرجع f"السلام عليكم يا {اسم}!"

الأسماء = ["أحمد"، "فاطمة"، "يوسف"]
لكل اسم في الأسماء:
    اطبع(تحية(اسم))

مجموع_الأعداد = مجموع(مدى(١، ١٠١))
اطبع("مجموع الأعداد من ١ إلى ١٠٠ =", مجموع_الأعداد)
`;

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* التخزين غير متاح */ }
  },
};

// ---------------------------------------------------------------------------
// التلوين
// ---------------------------------------------------------------------------
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--tok-keyword)", fontWeight: "600" },
  { tag: t.bool, color: "var(--tok-constant)", fontWeight: "600" },
  { tag: t.self, color: "var(--tok-self)" },
  { tag: t.standard(t.variableName), color: "var(--tok-builtin)" },
  { tag: t.standard(t.className), color: "var(--tok-exception)" },
  { tag: t.special(t.variableName), color: "var(--tok-special)" },
  { tag: [t.definition(t.variableName), t.definition(t.className)], color: "var(--tok-definition)", fontWeight: "600" },
  { tag: t.function(t.variableName), color: "var(--tok-function)" },
  { tag: t.propertyName, color: "var(--tok-property)" },
  { tag: t.namespace, color: "var(--tok-namespace)" },
  { tag: t.string, color: "var(--tok-string)" },
  { tag: t.number, color: "var(--tok-number)" },
  { tag: t.comment, color: "var(--tok-comment)" },
  { tag: t.meta, color: "var(--tok-special)" },
  { tag: t.operator, color: "var(--tok-operator)" },
  // ألوان وضع بايثون (اللوحة الجانبية)
  { tag: [t.function(t.definition(t.variableName)), t.function(t.variableName)], color: "var(--tok-function)" },
  { tag: t.className, color: "var(--tok-definition)" },
]);

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "var(--surface)", color: "var(--text)" },
  // بلا دمج للرموز: في الاتجاه من اليمين لليسار يُعكس >= المدمج فيبدو مثل <=
  ".cm-scroller": { fontFamily: "var(--code-font)", lineHeight: "1.75", fontVariantLigatures: "none" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--surface-2)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
  "&.cm-focused .cm-cursor": { borderInlineStartColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)", outline: "none" },
  ".cm-error-line": { backgroundColor: "var(--error-line)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--code-font)", maxHeight: "16em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-text)" },
  ".cm-completionDetail": { direction: "ltr", unicodeBidi: "isolate", opacity: "0.75", marginInlineStart: "1.5em", fontStyle: "normal" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
});

// ---------------------------------------------------------------------------
// تمييز سطر الخطأ
// ---------------------------------------------------------------------------
const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        decorations = effect.value
          ? Decoration.set([Decoration.line({ class: "cm-error-line" }).range(effect.value)])
          : Decoration.none;
      }
    }
    if (tr.docChanged) decorations = Decoration.none;
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------------------
// البرنامج الابتدائي: من الرابط، ثم التخزين المحلي، ثم المثال الافتراضي
// ---------------------------------------------------------------------------
function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function transform(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

async function encodeShare(code) {
  const bytes = new TextEncoder().encode(code);
  if (typeof CompressionStream === "function") {
    return "z" + toBase64Url(await transform(bytes, new CompressionStream("deflate-raw")));
  }
  return "p" + toBase64Url(bytes);
}

async function decodeShare(value) {
  const bytes = fromBase64Url(value.slice(1));
  const raw = value[0] === "z" ? await transform(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return new TextDecoder().decode(raw);
}

async function initialCode() {
  const match = /#code=([\w-]+)/.exec(location.hash);
  if (match) {
    try {
      return await decodeShare(match[1]);
    } catch {
      showToast("تعذّر قراءة البرنامج من الرابط");
    }
  }
  return storage.get(STORAGE_KEY) ?? DEFAULT_CODE;
}

// ---------------------------------------------------------------------------
// المخرجات
// ---------------------------------------------------------------------------
const output = $("output");
const MAX_LINES = 5000;
let pendingOutput = [];
let flushScheduled = false;

function appendOutput(text, cls) {
  pendingOutput.push([text, cls]);
  if (!flushScheduled) {
    flushScheduled = true;
    requestAnimationFrame(flushOutput);
  }
}

// أسطر المخرجات التي تبدأ بقوس أو علامة اقتباس أو رقم (مثل [١، ٢] أو ('أ', 3))
// هي تمثيلات بايثون فتُعرض من اليسار لليمين حتى لا تنقلب الأقواس
const CODE_LIKE = /^\s*[[({'"0-9a-zA-Z<-]/;
let currentLine = null;

function lineDirection(line) {
  if (CODE_LIKE.test(line.textContent)) line.setAttribute("dir", "ltr");
  else line.removeAttribute("dir");
}

// عزل النصوص المقتبسة في الأسطر البرمجية حتى لا تقلب خوارزمية الاتجاه
// ترتيب الأرقام والأقواس بين كلمتين عربيتين، مثل [('ا', 3), ('م', 2)]
const QUOTED = /('[^'\n]*'|"[^"\n]*")/;
function isolateQuoted(line) {
  if (line.getAttribute("dir") !== "ltr") return;
  for (const span of line.children) {
    const text = span.textContent;
    if (!QUOTED.test(text)) continue;
    span.textContent = "";
    text.split(QUOTED).forEach((part, index) => {
      if (!part) return;
      if (index % 2) {
        const bdi = document.createElement("bdi");
        bdi.textContent = part;
        span.appendChild(bdi);
      } else {
        span.appendChild(document.createTextNode(part));
      }
    });
  }
}

function newLine() {
  currentLine = document.createElement("div");
  currentLine.className = "line";
  output.appendChild(currentLine);
}

function flushOutput() {
  flushScheduled = false;
  if (!pendingOutput.length) return;
  const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  output.querySelector(".placeholder")?.remove();
  for (const [text, cls] of pendingOutput) {
    text.split("\n").forEach((part, index) => {
      if (index > 0) {
        // نهاية سطر: نغلق السطر المفتوح (أو ننشئ سطرًا فارغًا)
        if (!currentLine) newLine();
        lineDirection(currentLine);
        isolateQuoted(currentLine);
        currentLine = null;
      }
      if (!part) return;
      if (!currentLine) newLine();
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = part;
      currentLine.appendChild(span);
    });
  }
  if (currentLine) lineDirection(currentLine);
  pendingOutput = [];
  while (output.childNodes.length > MAX_LINES) output.firstChild.remove();
  if (nearBottom) output.scrollTop = output.scrollHeight;
}

function appendMeta(text) {
  flushOutput();
  currentLine = null;
  const div = document.createElement("div");
  div.className = "meta";
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function clearOutput() {
  pendingOutput = [];
  currentLine = null;
  output.textContent = "";
}

let toastTimer = null;
function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function setStatus(text, kind = "ready") {
  $("status-text").textContent = text;
  $("status").className = `status ${kind}`;
}

// ---------------------------------------------------------------------------
// عامل التشغيل (Pyodide)
// ---------------------------------------------------------------------------
const INPUT_BYTES = 64 * 1024;
const canInput = typeof SharedArrayBuffer === "function" && self.crossOriginIsolated;
let inputBuffer = null;
let worker = null;
let workerReady = false;
let running = false;
let translateId = 0;

function startWorker() {
  workerReady = false;
  $("run").disabled = true;
  worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
  if (canInput) {
    inputBuffer = new SharedArrayBuffer(8 + INPUT_BYTES);
    worker.postMessage({ type: "input-buffer", buffer: inputBuffer });
  }
  worker.onmessage = (event) => onWorkerMessage(event.data);
  worker.onerror = (event) => {
    setStatus("تعذّر تشغيل بايثون", "error");
    appendOutput(`تعذّر تحميل بيئة التشغيل: ${event.message || "خطأ غير معروف"}\n`, "stderr");
  };
}

function onWorkerMessage(message) {
  switch (message.type) {
    case "status":
      setStatus(message.text, "loading");
      break;
    case "ready":
      workerReady = true;
      $("run").disabled = false;
      $("version").textContent = `أفعى ${message.version}`;
      setStatus("جاهز");
      if (pythonVisible) requestTranslation();
      break;
    case "fatal":
      setStatus("تعذّر تحميل بايثون", "error");
      appendOutput(`تعذّر تحميل بيئة التشغيل: ${message.text}\n`, "stderr");
      break;
    case "stdout":
      appendOutput(message.text);
      break;
    case "stderr":
      appendOutput(message.text, "stderr");
      break;
    case "input-request":
      showInput();
      break;
    case "done":
      finishRun(message.errorLine, message.duration);
      break;
    case "translated":
      if (message.id === translateId) showPython(message.python);
      break;
  }
}

function run() {
  if (!workerReady || running) return;
  running = true;
  clearOutput();
  view.dispatch({ effects: setErrorLine.of(null) });
  $("run").hidden = true;
  $("stop").hidden = false;
  setStatus("قيد التشغيل…", "running");
  selectTab("output");
  worker.postMessage({ type: "run", code: view.state.doc.toString() });
}

function finishRun(errorLine, duration) {
  running = false;
  hideInput();
  $("run").hidden = false;
  $("stop").hidden = true;
  const seconds = (duration / 1000).toFixed(2);
  if (errorLine > 0 && errorLine <= view.state.doc.lines) {
    const line = view.state.doc.line(errorLine);
    view.dispatch({ effects: [setErrorLine.of(line.from), EditorView.scrollIntoView(line.from, { y: "center" })] });
    setStatus(`خطأ في السطر ${errorLine}`, "error");
    appendMeta(`— انتهى بخطأ في السطر ${errorLine} (${seconds} ث)`);
  } else {
    setStatus("جاهز");
    appendMeta(`— انتهى التنفيذ (${seconds} ث)`);
  }
}

function stop() {
  if (!running) return;
  worker.terminate();
  running = false;
  hideInput();
  flushOutput();
  appendMeta("— أُوقف البرنامج");
  $("run").hidden = false;
  $("stop").hidden = true;
  startWorker(); // عامل جديد (يُحمَّل بايثون من ذاكرة المتصفح بسرعة)
}

// ---------------------------------------------------------------------------
// الإدخال: «أدخل()»
// ---------------------------------------------------------------------------
function showInput() {
  flushOutput();
  $("input-row").hidden = false;
  $("input").value = "";
  $("input").focus();
}

function hideInput() {
  $("input-row").hidden = true;
}

function sendInput(text) {
  const flag = new Int32Array(inputBuffer, 0, 2);
  let bytes = new TextEncoder().encode(text);
  if (bytes.length > INPUT_BYTES) bytes = bytes.slice(0, INPUT_BYTES);
  new Uint8Array(inputBuffer, 8, INPUT_BYTES).set(bytes);
  Atomics.store(flag, 1, bytes.length);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

$("input-row").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("input").value;
  appendOutput(text + "\n", "echo");
  hideInput();
  sendInput(text);
  view.focus();
});

// ---------------------------------------------------------------------------
// لوحة بايثون المقابل
// ---------------------------------------------------------------------------
let pythonVisible = false;
let pythonView = null;
let translateTimer = null;

function requestTranslation() {
  if (!workerReady) return;
  translateId += 1;
  worker.postMessage({ type: "translate", id: translateId, code: view.state.doc.toString() });
}

function showPython(code) {
  if (!pythonView) {
    pythonView = new EditorView({
      parent: $("python"),
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(), python(), syntaxHighlighting(highlightStyle), baseTheme,
          EditorState.readOnly.of(true), EditorView.editable.of(false),
          EditorView.contentAttributes.of({ dir: "ltr", "aria-label": "شيفرة بايثون المقابلة" }),
          EditorView.theme({ "&": { direction: "ltr" } }),
        ],
      }),
    });
    return;
  }
  pythonView.dispatch({ changes: { from: 0, to: pythonView.state.doc.length, insert: code } });
}

function selectTab(name) {
  pythonVisible = name === "python";
  $("tab-output").classList.toggle("active", !pythonVisible);
  $("tab-python").classList.toggle("active", pythonVisible);
  $("tab-output").setAttribute("aria-selected", String(!pythonVisible));
  $("tab-python").setAttribute("aria-selected", String(pythonVisible));
  $("output").hidden = pythonVisible;
  $("python").hidden = !pythonVisible;
  $("clear").hidden = pythonVisible;
  if (pythonVisible) {
    if (!workerReady) showPython("# جارٍ تحميل بايثون…");
    requestTranslation();
  }
}

$("tab-output").addEventListener("click", () => selectTab("output"));
$("tab-python").addEventListener("click", () => selectTab("python"));
$("clear").addEventListener("click", () => {
  clearOutput();
  view.dispatch({ effects: setErrorLine.of(null) });
});

// ---------------------------------------------------------------------------
// المحرر
// ---------------------------------------------------------------------------
const vocabulary = await (await fetch("vocabulary.json")).json();
const languageCompartment = new Compartment();

const view = new EditorView({
  parent: $("editor"),
  state: EditorState.create({
    doc: await initialCode(),
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      editHistory(),
      foldGutter({ openText: "▾", closedText: "◂" }),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ icons: false }),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlightStyle),
      languageCompartment.of(afaa(vocabulary)),
      errorLineField,
      baseTheme,
      EditorState.tabSize.of(4),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ dir: "rtl", "aria-label": "محرر برنامج أفعى" }),
      EditorView.theme({ "&": { direction: "rtl" } }),
      keymap.of([
        { key: "Mod-Enter", run: () => { run(); return true; } },
        { key: "Mod-s", run: () => { save(); showToast("تم الحفظ في المتصفح"); return true; } },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        scheduleSave();
        if (pythonVisible) {
          clearTimeout(translateTimer);
          translateTimer = setTimeout(requestTranslation, 250);
        }
      }),
    ],
  }),
});

let saveTimer = null;
function save() {
  storage.set(STORAGE_KEY, view.state.doc.toString());
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function setCode(code) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: code },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
  view.focus();
}

// ---------------------------------------------------------------------------
// الأمثلة والمشاركة والسمة
// ---------------------------------------------------------------------------
fetch("examples.json").then((r) => r.json()).then((examples) => {
  const select = $("examples");
  for (const example of examples) {
    const option = document.createElement("option");
    option.value = example.name;
    option.textContent = example.title;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const example = examples.find((e) => e.name === select.value);
    select.value = "";
    if (!example) return;
    const current = view.state.doc.toString();
    if (current.trim() && current !== example.code && !confirm("سيُستبدل البرنامج الحالي بالمثال. هل تريد المتابعة؟")) return;
    setCode(example.code);
    clearOutput();
  });
});

$("share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#code=${await encodeShare(view.state.doc.toString())}`;
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    showToast("نُسخ رابط البرنامج — أرسله لمن تريد");
  } catch {
    showToast("الرابط في شريط العنوان، انسخه يدويًا");
  }
});

$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  storage.set("afaa:theme", next);
});

$("run").addEventListener("click", run);
$("stop").addEventListener("click", stop);

startWorker();
view.focus();
