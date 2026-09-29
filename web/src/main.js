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
import { OutputConsole } from "./console.js";
import { Runtime } from "./runtime.js";
import { codeFromHash, linkTo } from "./share.js";
import { UiRenderer } from "./ui.js";

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
async function initialCode() {
  try {
    const shared = await codeFromHash();
    if (shared != null) return shared;
  } catch {
    showToast("تعذّر قراءة البرنامج من الرابط");
  }
  return storage.get(STORAGE_KEY) ?? DEFAULT_CODE;
}

// ---------------------------------------------------------------------------
// المخرجات والحالة
// ---------------------------------------------------------------------------
const output = new OutputConsole($("output"));

let toastTimer = null;
function showToast(text, kind = "info") {
  const toast = $("toast");
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function setStatus(text, kind = "ready") {
  $("status-text").textContent = text;
  $("status").className = `status ${kind}`;
}

function showErrorLine(errorLine) {
  if (!(errorLine > 0 && errorLine <= view.state.doc.lines)) return false;
  const line = view.state.doc.line(errorLine);
  view.dispatch({ effects: [setErrorLine.of(line.from), EditorView.scrollIntoView(line.from, { y: "center" })] });
  return true;
}

// الأزرار: «تشغيل» متاح دائمًا بعد التحميل (يعيد تشغيل التطبيق)، و«إيقاف» أثناء العمل
function setRunning(active) {
  $("run").hidden = runtime.running;
  $("stop").hidden = !active;
}

// ---------------------------------------------------------------------------
// الواجهة (مكتبة «واجهات»)
// ---------------------------------------------------------------------------
const uiRoot = $("ui-root");
let switchedToUi = false;
const ui = new UiRenderer(uiRoot, {
  sendEvent: (id, name, data, mode) => runtime.sendEvent(id, name, data, mode),
  onTitle: (title) => { $("ui-title").textContent = title; },
  onToast: (text, kind) => showToast(text, kind),
  onCreate: () => {
    $("ui-empty").hidden = true;
    if (!switchedToUi) {
      switchedToUi = true;
      selectTab("ui");
    }
  },
});

function resetUi() {
  ui.reset();
  $("toast").hidden = true;
  switchedToUi = false;
  $("ui-title").textContent = "";
  $("ui-empty").hidden = false;
  $("ui").classList.remove("stopped");
}

// ---------------------------------------------------------------------------
// التشغيل
// ---------------------------------------------------------------------------
const runtime = new Runtime({
  onStatus: (text) => setStatus(text, "loading"),
  onReady: (version) => {
    $("run").disabled = false;
    $("version").textContent = `أفعى ${version}`;
    setStatus("جاهز");
    if (activeTab === "python") runtime.translate(view.state.doc.toString());
  },
  onFatal: (text) => {
    setStatus("تعذّر تحميل بايثون", "error");
    output.append(`تعذّر تحميل بيئة التشغيل: ${text}\n`, "stderr");
  },
  onStdout: (text) => output.append(text),
  onStderr: (text) => output.append(text, "stderr"),
  onInputRequest: () => showInput(),
  onUiOps: (ops) => ui.apply(ops),
  onUiError: (errorLine) => {
    showErrorLine(errorLine);
    setStatus(`خطأ في السطر ${errorLine}`, "error");
    showToast("حدث خطأ في التطبيق، انظر المخرجات", "error");
  },
  onDone: ({ errorLine, duration, app }) => finishRun(errorLine, duration, app),
  onTranslated: (python) => showPython(python),
});

function run() {
  if (!runtime.ready) return;
  if (runtime.running) return;
  output.clear();
  resetUi();
  view.dispatch({ effects: setErrorLine.of(null) });
  if (!runtime.run(view.state.doc.toString())) return;
  setRunning(true);
  setStatus("قيد التشغيل…", "running");
  if (activeTab === "python") selectTab("output");
}

function finishRun(errorLine, duration, app) {
  hideInput();
  const seconds = (duration / 1000).toFixed(2);
  if (showErrorLine(errorLine)) {
    setStatus(`خطأ في السطر ${errorLine}`, "error");
    output.meta(`— انتهى بخطأ في السطر ${errorLine} (${seconds} ث)`);
  } else if (app) {
    setStatus("التطبيق يعمل", "live");
    output.meta(`— التطبيق يعمل، تفاعل معه في لسان «الواجهة» (${seconds} ث)`);
  } else {
    setStatus("جاهز");
    output.meta(`— انتهى التنفيذ (${seconds} ث)`);
  }
  setRunning(app);
}

function stop() {
  if (!runtime.running && !runtime.appLive) return;
  const wasApp = runtime.appLive;
  runtime.stop();
  ui.stopAllTimers();
  hideInput();
  output.meta(wasApp ? "— أُوقف التطبيق" : "— أُوقف البرنامج");
  $("ui").classList.add("stopped");
  $("run").disabled = true;
  setRunning(false);
}

// ---------------------------------------------------------------------------
// الإدخال: «أدخل()»
// ---------------------------------------------------------------------------
function showInput() {
  output.flush();
  $("input-row").hidden = false;
  $("input").value = "";
  $("input").focus();
}

function hideInput() {
  $("input-row").hidden = true;
}

$("input-row").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("input").value;
  output.append(text + "\n", "echo");
  hideInput();
  runtime.sendInput(text);
  view.focus();
});

// ---------------------------------------------------------------------------
// الألسنة: المخرجات | الواجهة | بايثون المقابل
// ---------------------------------------------------------------------------
let activeTab = "output";
let pythonView = null;
let translateTimer = null;

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

const TABS = { output: "output", ui: "ui", python: "python" };
function selectTab(name) {
  activeTab = name;
  for (const tab of Object.keys(TABS)) {
    const selected = tab === name;
    $(`tab-${tab}`).classList.toggle("active", selected);
    $(`tab-${tab}`).setAttribute("aria-selected", String(selected));
    $(TABS[tab]).hidden = !selected;
  }
  $("clear").hidden = name !== "output";
  if (name === "python") {
    if (!runtime.ready) showPython("# جارٍ تحميل بايثون…");
    runtime.translate(view.state.doc.toString());
  }
}

for (const tab of Object.keys(TABS)) {
  $(`tab-${tab}`).addEventListener("click", () => selectTab(tab));
}
$("clear").addEventListener("click", () => {
  output.clear();
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
        if (activeTab === "python") {
          clearTimeout(translateTimer);
          translateTimer = setTimeout(() => runtime.translate(view.state.doc.toString()), 250);
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
// الأمثلة
// ---------------------------------------------------------------------------
fetch("examples.json").then((r) => r.json()).then((examples) => {
  const select = $("examples");
  const groups = new Map();
  for (const example of examples) {
    const label = example.group || "أمثلة";
    if (!groups.has(label)) {
      const group = document.createElement("optgroup");
      group.label = label;
      select.appendChild(group);
      groups.set(label, group);
    }
    const option = document.createElement("option");
    option.value = example.name;
    option.textContent = example.title;
    groups.get(label).appendChild(option);
  }
  select.addEventListener("change", () => {
    const example = examples.find((e) => e.name === select.value);
    select.value = "";
    if (!example) return;
    const current = view.state.doc.toString();
    if (current.trim() && current !== example.code && !confirm("سيُستبدل البرنامج الحالي بالمثال. هل تريد المتابعة؟")) return;
    setCode(example.code);
    output.clear();
  });
});

// ---------------------------------------------------------------------------
// المشاركة، والتطبيق المستقل، والتصدير
// ---------------------------------------------------------------------------
async function copyLink(url, message) {
  try {
    await navigator.clipboard.writeText(url);
    showToast(message, "success");
  } catch {
    prompt("انسخ الرابط:", url);
  }
}

$("share").addEventListener("click", async () => {
  const url = await linkTo(location.pathname.split("/").pop() || "./", view.state.doc.toString());
  history.replaceState(null, "", url);
  copyLink(url, "نُسخ رابط البرنامج — أرسله لمن تريد");
});

$("app-window").addEventListener("click", async () => {
  window.open(await linkTo("app.html", view.state.doc.toString()), "_blank");
});

$("app-link").addEventListener("click", async () => {
  copyLink(await linkTo("app.html", view.state.doc.toString()),
    "نُسخ رابط التطبيق — من يفتحه يرى التطبيق مباشرة دون المحرر");
});

$("app-export").addEventListener("click", async () => {
  const button = $("app-export");
  button.disabled = true;
  showToast("جارٍ تجهيز الموقع للتنزيل…");
  try {
    const { exportSite } = await import("./export.js");
    const name = await exportSite(view.state.doc.toString(), $("ui-title").textContent);
    showToast(`نُزّل الملف ${name}`, "success");
  } catch (err) {
    console.error(err);
    showToast("تعذّر تجهيز الملف", "error");
  } finally {
    button.disabled = false;
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

runtime.start();
view.focus();
