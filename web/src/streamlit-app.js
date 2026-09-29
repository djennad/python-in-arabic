// صفحة تطبيقات «ستريمليت»: تشغّل برنامج أفعى بمكتبة Streamlit داخل المتصفح (stlite).
//
// مصدر البرنامج:
//   - داخل المحرر (?embed): رسائل من الصفحة الأم، وكل تشغيل جديد يحدّث التطبيق دون إعادة التحميل
//   - الرابط: streamlit.html#code=...
//   - الملف program.af بجانب الصفحة (المواقع المُصدَّرة)

import { codeFromHash, encodeCode } from "./share.js";

const $ = (id) => document.getElementById(id);
const PROGRAM = "app.af";
const embedded = new URLSearchParams(location.search).has("embed");
const base = (path) => new URL(path, document.baseURI).href;

function toBase64(text) {
  let binary = "";
  new TextEncoder().encode(text).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// السكربت الرئيسي الذي يعيد Streamlit تشغيله عند كل تفاعل: يترجم برنامج أفعى وينفّذه
function launcher(code) {
  return [
    "# مولَّد تلقائيا: برنامج أفعى مضمَّن بترميز base64",
    "import base64",
    "from afaa.streamlit_runner import run_source",
    `run_source(base64.b64decode("${toBase64(code)}").decode("utf-8"), ${JSON.stringify(PROGRAM)})`,
    "",
  ].join("\n");
}

function hideLoadingWhenReady() {
  const done = () => {
    $("loading").hidden = true;
    if (!embedded) $("credits").hidden = false;
  };
  // جاهز عندما يظهر عنصر حقيقي، لا الهيكل الرمادي الذي يعرضه Streamlit أثناء التحميل
  const ready = () => !document.querySelector('#root [data-testid="stAppSkeleton"]')
    && document.querySelector('#root [data-testid="stMainBlockContainer"] [data-testid="stElementContainer"]');
  if (ready()) return done();
  const observer = new MutationObserver(() => {
    if (ready()) {
      observer.disconnect();
      done();
    }
  });
  observer.observe($("root"), { childList: true, subtree: true });
}

let controller = null;
let pending = null;

async function run(code) {
  if (controller) {
    // التطبيق يعمل: تحديث الملف يكفي ليعيد Streamlit التشغيل
    await controller.writeFile("app.py", launcher(code));
    return;
  }
  const { mount } = await import(base("streamlit/stlite/stlite.js"));
  controller = mount({
    pyodideUrl: base("streamlit/pyodide/pyodide.mjs"),
    entrypoint: "app.py",
    files: { "app.py": launcher(code) },
    requirements: ["toml"],
    archives: [{ url: base("afaa.zip"), format: "zip" }],
    idbfsMountpoints: ["/data"],
    streamlitConfig: {
      "client.toolbarMode": "viewer",
      "server.runOnSave": true,
    },
    disableProgressToasts: true,
    disableModuleAutoLoadToasts: true,
  }, $("root"));
  hideLoadingWhenReady();
}

async function loadProgram() {
  const fromLink = await codeFromHash().catch(() => null);
  if (fromLink != null) return { code: fromLink, exported: false };
  try {
    const response = await fetch("program.af", { cache: "no-cache" });
    if (response.ok) return { code: await response.text(), exported: true };
  } catch { /* لا يوجد ملف */ }
  return { code: null, exported: false };
}

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

if (embedded) {
  // داخل المحرر: البرنامج يصل برسالة من الصفحة الأم (من الأصل نفسه فقط)
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "afaa-streamlit-run") return;
    pending = (pending || Promise.resolve()).then(() => run(event.data.code)).catch((err) => {
      console.error(err);
      $("loading-text").textContent = "تعذّر تشغيل التطبيق";
    });
  });
  window.parent.postMessage({ type: "afaa-streamlit-ready" }, location.origin);
} else {
  const loaded = await loadProgram();
  if (loaded.code == null) {
    $("loading-text").textContent = "لا يوجد برنامج لتشغيله. افتح هذه الصفحة من ساحة أفعى، أو ضع ملف program.af بجانبها.";
    document.querySelector(".spinner").hidden = true;
  } else {
    const editor = await editorUrl(loaded.exported);
    editor.hash = `code=${await encodeCode(loaded.code)}`;
    $("view-source").href = editor.href;
    run(loaded.code);
  }
}
