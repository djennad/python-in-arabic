// اختبارات مكتبة «واجهات» والتطبيقات المستقلة والتصدير في متصفح حقيقي.
// الاستخدام: شغّل الخادم (python3 build.py --serve) ثم: node tests/gui.mjs
// المتغيرات: URL (افتراضيًا http://127.0.0.1:8000/) و CHROMIUM_PATH و SCREENSHOTS (اختيارية)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { unzipSync } from "fflate";

const URL_BASE = process.env.URL || "http://127.0.0.1:8000/";
const SHOTS = process.env.SCREENSHOTS || "";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// لغة UTF-8 ضرورية ليحتفظ المتصفح بأسماء الملفات العربية عند التنزيل
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

const ui = (selector, options) => page.locator(`#ui-root ${selector}`, options);
async function setCode(code) {
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}
async function runApp() {
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(
    () => ["التطبيق يعمل", "جاهز"].includes(document.getElementById("status-text").textContent)
      || document.getElementById("status").classList.contains("error"),
    null, { timeout: 30000 });
}
async function loadExample(name) {
  await page.selectOption("#examples", name);
  await runApp();
}
const settle = () => page.waitForTimeout(250);

// 1. كل أمثلة الواجهات تعمل دون أخطاء
const examples = await page.evaluate(async () => (await (await fetch("examples.json")).json())
  .filter((e) => e.name.startsWith("gui/")).map((e) => e.name));
for (const name of examples) {
  await loadExample(name);
  const status = await page.locator("#status-text").innerText();
  const widgets = await ui(".ui-el").count();
  check(`example ${name}`, status === "التطبيق يعمل" && widgets > 3, `status=${status} widgets=${widgets}`);
}

// 2. الحاسبة: حقول الأعداد والقائمة والجدول
await loadExample("gui/calculator.af");
await ui(".ui-number").nth(0).fill("7");
await ui(".ui-select").selectOption("ضرب ×");
await ui(".ui-number").nth(1).fill("6");
await settle();
await ui(".ui-button").getByText("احسب", { exact: true }).click();
await settle();
const result = await ui(".ui-label").last().innerText();
const cells = await ui(".ui-table td").allInnerTexts();
check("calculator", result.includes("42") && cells.join("|") === "7|ضرب ×|6|42", JSON.stringify([result, cells]));
// الفأرة ما زالت فوق الزر: يجب ألا تطغى أنماط أزرار المحرر على أزرار التطبيق
const hoveredBg = await ui(".ui-button").getByText("احسب", { exact: true }).evaluate((e) => getComputedStyle(e).backgroundColor);
const accent = await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.style.background = "var(--accent)";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
});
check("app button keeps its color on hover", hoveredBg === accent, `${hoveredBg} vs ${accent}`);
const cellAlign = await ui(".ui-table td").first().evaluate((e) => getComputedStyle(e).textAlign);
check("numbers in RTL table align right", cellAlign === "right", cellAlign);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/gui-calculator.png` });

// 3. المهام: الكتابة وEnter والمربعات والحذف
await loadExample("gui/todo.af");
await ui(".ui-input").fill("مهمة الاختبار");
await ui(".ui-input").press("Enter");
await settle();
let tasks = await ui(".ui-checkbox").allInnerTexts();
check("todo add via Enter", tasks.length === 4 && tasks[3].includes("مهمة الاختبار"), JSON.stringify(tasks));
await ui(".ui-checkbox input").nth(0).check();
await ui(".ui-checkbox input").nth(3).check();
await settle();
const summary = await ui(".ui-label").first().innerText();
await ui(".ui-button", { hasText: "احذف المنجزة" }).click();
await settle();
tasks = await ui(".ui-checkbox").allInnerTexts();
check("todo check + remove", summary.includes("2 من 4") && tasks.length === 2, JSON.stringify([summary, tasks]));
const toast = await page.locator("#toast").innerText();
check("toast", toast.includes("حُذفت"), JSON.stringify(toast));

// 4. الرسم: النقر على اللوحة يرسم بالفعل (فحص البكسلات)
await loadExample("gui/drawing.af");
const canvas = ui(".ui-canvas");
const pixel = (x, y) => canvas.evaluate((c, [x, y]) => {
  const r = c.width / c.getBoundingClientRect().width;
  return [...c.getContext("2d").getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data];
}, [x, y]);
const box = await canvas.boundingBox();
const before = await pixel(40, 40);
await canvas.click({ position: { x: 40, y: 40 } });
await settle();
const after = await pixel(40, 40);
check("canvas click draws", before.join() !== after.join() && after[2] > 150, JSON.stringify([before, after, box.width]));
await ui(".ui-button", { hasText: "نجمة" }).click();
await settle();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/gui-drawing.png` });

// 5. ساعة الإيقاف: المؤقت يتقدم ويتوقف
await loadExample("gui/clock.af");
await ui(".ui-button").first().click();
await page.waitForTimeout(1200);
await ui(".ui-button").first().click();
await settle();
const t1 = await ui(".ui-label").first().innerText();
await page.waitForTimeout(600);
const t2 = await ui(".ui-label").first().innerText();
const tenths = Number(t1.slice(-1)) + Number(t1.slice(3, 5)) * 10;
check("timer runs and pauses", tenths >= 8 && tenths <= 16 && t1 === t2, JSON.stringify([t1, t2]));

// 6. خطأ داخل دالة حدث: يظهر بالعربية ويُميَّز سطره، والتطبيق يستمر
await setCode('من واجهات استورد *\nدالة خطأ_ما():\n    ١ / ٠\nزر("خطأ"، خطأ_ما)\nزر("سليم"، لامدا: تنبيه("ما زلت أعمل"))\n');
await runApp();
await ui(".ui-button").first().click();
await settle();
const errLine = await page.locator(".cm-error-line").innerText().catch(() => "");
const errOut = await page.locator("#output").innerText();
await ui(".ui-button").nth(1).click();
await settle();
check("handler error", errLine.includes("١ / ٠") && errOut.includes("خطأ_قسمة_على_صفر")
  && (await page.locator("#toast").innerText()).includes("ما زلت أعمل"), JSON.stringify(errLine));

// 7. الإيقاف يجمّد الواجهة
await page.click("#stop");
check("stop freezes app", await page.locator("#ui").evaluate((e) => e.classList.contains("stopped")));
await page.waitForFunction(() => document.getElementById("status-text").textContent === "جاهز", null, { timeout: 60000 });

// 8. نافذة مستقلة: التطبيق وحده في لسان جديد
await page.selectOption("#examples", "gui/counter.af");
await runApp();
await page.click("#tab-ui");
const [popup] = await Promise.all([context.waitForEvent("page"), page.click("#app-window")]);
watch(popup);
await popup.waitForSelector("#ui-root .ui-button", { timeout: 60000 });
await popup.locator(".ui-button", { hasText: "زيادة" }).click();
await popup.locator(".ui-button", { hasText: "زيادة" }).click();
await popup.waitForTimeout(300);
check("standalone window", (await popup.title()) === "عدّاد"
  && (await popup.locator(".ui-label").nth(1).innerText()) === "2"
  && popup.url().includes("app.html#code="), popup.url().slice(0, 60));
if (SHOTS) await popup.screenshot({ path: `${SHOTS}/gui-standalone.png` });
const source = await popup.locator("#view-source").getAttribute("href");
check("view source link", source.includes("#code=") && !source.includes("app.html"), source.slice(0, 60));
await popup.close();

// 9. رابط التطبيق (نشر فوري): يُنسخ ويعمل
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
await page.click("#app-link");
await settle();
const appLink = await page.evaluate(() => navigator.clipboard.readText());
const linked = watch(await context.newPage());
await linked.goto(appLink);
await linked.waitForSelector("#ui-root .ui-button", { timeout: 60000 });
const linkedButtons = await linked.locator("#ui-root .ui-button").count();
check("app link", appLink.includes("app.html#code=") && linkedButtons === 3, `${appLink.slice(0, 50)} buttons=${linkedButtons}`);
await linked.close();

// 10. برنامج بلا واجهة في الصفحة المستقلة: تظهر مخرجاته
const plain = watch(await context.newPage());
const cliLink = execFileSync("python3", ["-m", "afaa", "--web", join(ROOT, "examples", "primes.af")],
  { env: { ...process.env, AFAA_PLAYGROUND: URL_BASE, PYTHONPATH: ROOT, BROWSER: "true" }, encoding: "utf-8" }).trim();
await plain.goto(cliLink);
await plain.waitForFunction(() => document.getElementById("app-output").innerText.includes("97"), null, { timeout: 60000 });
check("afaa --web link + console program", cliLink.startsWith(URL_BASE + "app.html#code=z"));
await plain.close();

// 11. التصدير كموقع مستقل: التنزيل، وفك الضغط، والتشغيل من خادم عادي (مثل أي استضافة)
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#app-export")]);
const zipPath = join(mkdtempSync(join(tmpdir(), "afaa-export-")), download.suggestedFilename());
await download.saveAs(zipPath);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const names = Object.keys(files);
const site = mkdtempSync(join(tmpdir(), "afaa-site-"));
for (const [name, data] of Object.entries(files)) {
  mkdirSync(dirname(join(site, name)), { recursive: true });
  writeFileSync(join(site, name), data);
}
const program = new TextDecoder().decode(files["program.af"]);
check("export zip contents", download.suggestedFilename() === "عدّاد.zip"
  && ["index.html", "app.js", "worker.js", "afaa.zip", "pyodide/pyodide.asm.wasm", "config.json", "اقرأني.txt"].every((n) => names.includes(n))
  && program.includes("عدّاد بسيط"),
  `${download.suggestedFilename()} ${names.length} files, ${(readFileSync(zipPath).length / 1e6).toFixed(1)}MB, `
  + `missing=${["index.html", "app.js", "worker.js", "afaa.zip", "pyodide/pyodide.asm.wasm", "config.json", "اقرأني.txt"].filter((n) => !names.includes(n))}`);

const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: site, stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 1000));
  const exported = watch(await context.newPage());
  await exported.goto(`http://127.0.0.1:${port}/`);
  await exported.waitForSelector("#ui-root .ui-button", { timeout: 90000 });
  await exported.locator(".ui-button", { hasText: "زيادة" }).click();
  await exported.waitForTimeout(300);
  check("exported site runs from a plain server", (await exported.locator(".ui-label").nth(1).innerText()) === "1"
    && (await exported.title()) === "عدّاد", await exported.title());
  if (SHOTS) await exported.screenshot({ path: `${SHOTS}/gui-exported.png` });
} finally {
  server.kill();
}

console.log(results.join("\n"));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
const failed = results.filter((r) => r.startsWith("FAIL")).length;
if (failed || errors.length) {
  console.error(`${failed} فحص فشل، ${errors.length} خطأ في وحدة التحكم`);
  process.exit(1);
}
