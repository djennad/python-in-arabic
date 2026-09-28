// عامل الخلفية: يحمّل بايثون (Pyodide) ولغة أفعى وينفّذ البرامج بعيدًا عن
// واجهة الصفحة، حتى لا تتجمد الصفحة مع الحلقات الطويلة ويمكن إيقاف البرنامج.

import { loadPyodide } from "./pyodide/pyodide.mjs";

const PROGRAM = "<البرنامج>";

let pyodide = null;
let inputBuffer = null; // SharedArrayBuffer لتمرير الإدخال من الصفحة
const decoder = new TextDecoder();

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function streamWriter(type) {
  const streamDecoder = new TextDecoder();
  return {
    write(bytes) {
      post(type, { text: streamDecoder.decode(bytes, { stream: true }) });
      return bytes.length;
    },
  };
}

// يُستدعى عند كل «أدخل()»: يطلب سطرًا من الصفحة وينتظره
function readLine() {
  if (!inputBuffer) {
    post("stderr", {
      text: "الإدخال غير متاح في هذا المتصفح (يتطلب عزل الأصل cross-origin isolation).\n",
    });
    return null; // يرفع خطأ_نهاية_الملف في البرنامج
  }
  const flag = new Int32Array(inputBuffer, 0, 2);
  Atomics.store(flag, 0, 0);
  post("input-request");
  Atomics.wait(flag, 0, 0);
  const length = Atomics.load(flag, 1);
  if (length < 0) return null;
  const bytes = new Uint8Array(length);
  bytes.set(new Uint8Array(inputBuffer, 8, length));
  return decoder.decode(bytes) + "\n";
}

const SETUP = `
import sys
import afaa
from afaa.errors import format_exception
from afaa.runtime import install
from afaa.translator import translate as _afaa_translate
install()

def _afaa_run(source):
    try:
        afaa.run_source(source, ${JSON.stringify(PROGRAM)})
        return 0
    except SystemExit:
        return 0
    except BaseException as exc:
        # نبدأ التتبع من أول إطار في برنامج المستخدم
        tb = exc.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename != ${JSON.stringify(PROGRAM)}:
            tb = tb.tb_next
        sys.stderr.write(format_exception(exc.with_traceback(tb)))
        if isinstance(exc, SyntaxError) and exc.filename == ${JSON.stringify(PROGRAM)}:
            return exc.lineno or 0
        line = 0
        tb = exc.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == ${JSON.stringify(PROGRAM)}:
                line = tb.tb_lineno
            tb = tb.tb_next
        return line
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
`;

async function init() {
  post("status", { text: "جارٍ تحميل بايثون…" });
  pyodide = await loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href });
  post("status", { text: "جارٍ تحميل أفعى…" });
  const archive = await (await fetch(new URL("./afaa.zip", import.meta.url))).arrayBuffer();
  pyodide.unpackArchive(archive, "zip");
  pyodide.setStdout(streamWriter("stdout"));
  pyodide.setStderr(streamWriter("stderr"));
  pyodide.setStdin({ stdin: readLine, isatty: false });
  pyodide.runPython(SETUP);
  const version = pyodide.runPython("import sys; afaa.__version__ + ' / Python ' + sys.version.split()[0]");
  post("ready", { version });
}

const handlers = {
  async run({ code }) {
    const started = performance.now();
    // callPromising يتيح لـ asyncio (تزامن.شغل) العمل داخل المتصفح
    const program = pyodide.globals.get("_afaa_run");
    const errorLine = typeof program.callPromising === "function"
      ? await program.callPromising(code)
      : program(code);
    post("done", { errorLine, duration: performance.now() - started });
  },
  translate({ code, id }) {
    let python = "";
    try {
      python = pyodide.globals.get("_afaa_translate")(code);
    } catch (err) {
      python = `# تعذّرت الترجمة: ${err.message}`;
    }
    post("translated", { id, python });
  },
};

// الرسائل تُعالج بالترتيب: الترجمة المطلوبة أثناء التشغيل تنتظر انتهاءه
let queue = Promise.resolve();
const ready = init().catch((err) => post("fatal", { text: String(err && err.message || err) }));

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "input-buffer") {
    inputBuffer = message.buffer;
    return;
  }
  queue = queue.then(() => ready).then(() => handlers[message.type]?.(message)).catch((err) => {
    post("stderr", { text: `خطأ داخلي: ${err && err.message || err}\n` });
    post("done", { errorLine: 0, duration: 0 });
  });
};
