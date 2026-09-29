// اختبارات «ستريمليت» في المتصفح: التشغيل داخل المحرر، والتحديث الفوري، والنافذة المستقلة، والتصدير.
// الاستخدام: شغّل الخادم (python3 build.py --serve) ثم: node tests/streamlit.mjs
// المتغيرات: URL (افتراضيًا http://127.0.0.1:8000/) و CHROMIUM_PATH و SCREENSHOTS (اختيارية)
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { unzipSync } from "fflate";

const URL_BASE = process.env.URL || "http://127.0.0.1:8000/";
const SHOTS = process.env.SCREENSHOTS || "";
const BOOT = 240000;   // التحميل الأول لبيئة ستريمليت
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const errors = [];
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);

function watch(page) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  return page;
}

const page = watch(await context.newPage());
await page.goto(URL_BASE);
await page.waitForFunction(() => document.getElementById("status-text").textContent === "جاهز", null, { timeout: 120000 });

async function setCode(code) {
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}
const frame = () => page.frameLocator("iframe.streamlit-frame");

// 1. مثال ستريمليت يعمل في لسان «الواجهة»
await page.selectOption("#examples", "streamlit/hello.af");
await page.keyboard.press("Control+Enter");
await frame().locator("h1", { hasText: "أول موقع بلغة أفعى" }).waitFor({ timeout: BOOT });
check("streamlit example runs in the UI tab",
  (await page.locator("#status-text").innerText()) === "تطبيق ستريمليت يعمل"
  && await page.locator("#ui").evaluate((e) => e.classList.contains("streamlit") && !e.hidden));

// 2. التفاعل: كتابة اسم تظهر رسالة النجاح
const input = frame().locator('[data-testid="stTextInput"] input');
await input.fill("سارة");
await input.press("Enter");
await frame().locator('[data-testid="stAlertContentSuccess"]', { hasText: "أهلا يا سارة" }).waitFor({ timeout: 20000 });
check("widgets interact", true);
const font = await frame().locator("h1").first().evaluate((e) => getComputedStyle(e).fontFamily);
check("arabic font + rtl", font.includes("IBM Plex Sans Arabic"), font);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/streamlit-editor.png` });

// 3. تعديل البرنامج وإعادة التشغيل يحدّث التطبيق دون إعادة تحميل البيئة
const program = `استورد ستريمليت باسم ست
ست.اضبط_الصفحة(عنوان_الصفحة="لوحتي")
ست.عنوان("نسخة معدلة")
أ، ب = ست.أعمدة(٢)
أ.مقياس("الطلاب"، ١٢٠، الفرق=٥)
مع ب:
    ست.رسم_أعمدة({"العدد": [٣، ٥، ٢]})
مع ست.الشريط_الجانبي:
    ست.اختيار_واحد("اللون"، ["أحمر"، "أزرق"])
`;
await setCode(program);
const started = Date.now();
await page.keyboard.press("Control+Enter");
await frame().locator("h1", { hasText: "نسخة معدلة" }).waitFor({ timeout: 30000 });
await frame().locator('[data-testid="stMetricValue"]', { hasText: "120" }).waitFor({ timeout: 10000 });
await frame().locator('[data-testid="stSidebar"] label', { hasText: "أزرق" }).waitFor({ timeout: 10000 });
check("rerun updates the app", true, `${Date.now() - started}ms`);

// 4. الأخطاء بالعربية داخل التطبيق
await setCode(`استورد ستريمليت باسم ست\nست.عنوان("قبل")\nاطبع(غير_معرف)\n`);
await page.keyboard.press("Control+Enter");
await frame().locator('[data-testid="stAlertContentError"]', { hasText: "حدث خطأ في البرنامج" }).waitFor({ timeout: 30000 });
const trace = await frame().locator('[data-testid="stCode"]').first().innerText();
check("arabic errors", trace.includes("خطأ_اسم") && !trace.includes("streamlit"), trace.split("\n").at(-1));

// 5. برنامج عادي بعد ستريمليت يعود إلى الواجهة العادية، والإيقاف يغلق التطبيق
await setCode(`اطبع("مرحبا")\n`);
await page.keyboard.press("Control+Enter");
await page.waitForFunction(() => document.getElementById("output").innerText.includes("مرحبا"), null, { timeout: 30000 });
check("normal program closes streamlit", await page.locator("iframe.streamlit-frame").count() === 0);

// 6. النافذة المستقلة ورابط التطبيق
await setCode(program);
await page.keyboard.press("Control+Enter");
await frame().locator("h1", { hasText: "نسخة معدلة" }).waitFor({ timeout: BOOT });
const [popup] = await Promise.all([context.waitForEvent("page"), page.click("#app-window")]);
watch(popup);
await popup.locator("h1", { hasText: "نسخة معدلة" }).waitFor({ timeout: BOOT });
await popup.locator("#loading").waitFor({ state: "hidden", timeout: 20000 });
check("standalone window", popup.url().includes("streamlit.html#code=")
  && await popup.locator("#credits").isVisible(), popup.url().slice(0, 60));
if (SHOTS) await popup.screenshot({ path: `${SHOTS}/streamlit-standalone.png` });
await popup.close();

await page.click("#stop");
check("stop closes the app", await page.locator("iframe.streamlit-frame").count() === 0);

// 7. التصدير كموقع مستقل يعمل من خادم عادي
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#app-export")]);
const zipPath = join(mkdtempSync(join(tmpdir(), "afaa-st-export-")), download.suggestedFilename());
await download.saveAs(zipPath);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const names = Object.keys(files);
const needed = ["index.html", "streamlit-app.js", "afaa.zip", "program.af", "config.json",
  "streamlit/stlite/stlite.js", "streamlit/pyodide/pyodide.asm.wasm", "streamlit/pyodide/pyodide-lock.json"];
check("export zip contents", download.suggestedFilename() === "لوحتي.zip" && needed.every((n) => names.includes(n))
  && !names.some((n) => n.startsWith("pyodide/")),
  `${names.length} files, ${(readFileSync(zipPath).length / 1e6).toFixed(1)}MB missing=${needed.filter((n) => !names.includes(n))}`);
const site = mkdtempSync(join(tmpdir(), "afaa-st-site-"));
for (const [name, data] of Object.entries(files)) {
  mkdirSync(dirname(join(site, name)), { recursive: true });
  writeFileSync(join(site, name), data);
}
const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: site, stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 1000));
  const exported = watch(await context.newPage());
  await exported.goto(`http://127.0.0.1:${port}/`);
  await exported.locator("h1", { hasText: "نسخة معدلة" }).waitFor({ timeout: BOOT });
  check("exported site runs from a plain server", (await exported.title()) === "لوحتي", await exported.title());
} finally {
  server.kill();
}

await browser.close();
for (const line of results) console.log(line);
// أخطاء متوقعة لا تعني فشلا: طلبات Streamlit لخدمات غير موجودة في المتصفح
const unexpected = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(e));
if (unexpected.length) console.log("ERRORS:\n" + unexpected.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) || unexpected.length ? 1 : 0);
