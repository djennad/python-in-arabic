// اختبارات ساحة أفعى في متصفح حقيقي.
// الاستخدام: شغّل الخادم (python3 build.py --serve) ثم: node tests/e2e.mjs
// المتغيرات: URL (افتراضيًا http://127.0.0.1:8000/) و CHROMIUM_PATH (اختياري)
import { chromium } from "playwright-core";
const URL = process.env.URL || "http://127.0.0.1:8000/";
const SHOTS = process.env.SCREENSHOTS || "";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("dialog", (d) => d.accept());
const results = [];
const check = (name, ok, extra = "") => { results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

await page.goto(URL);
const t0 = Date.now();
await page.waitForFunction(() => document.getElementById("status-text").textContent === "جاهز", null, { timeout: 120000 });
check("ready", true, `${Date.now() - t0}ms, isolated=${await page.evaluate(() => crossOriginIsolated)}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-initial.png` });
check("idle: stop & input hidden", !(await page.isVisible("#stop")) && !(await page.isVisible("#input-row")));
await page.evaluate(() => document.fonts.ready);
check("arabic font loaded", await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans Arabic"', "مرحبا") && [...document.fonts].some(f => f.family.includes("IBM Plex Sans Arabic") && f.status === "loaded")));

const out = () => page.locator("#output").innerText();
async function setCode(code) {
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}
async function runAndWait() {
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => document.getElementById("stop").hidden && document.querySelector("#output .meta"), null, { timeout: 60000 });
}

// 1. default program
await runAndWait();
let o = await out();
check("default program", o.includes("السلام عليكم يا أحمد!") && o.includes("5050"), JSON.stringify(o.slice(0, 80)));

// 2. input
await setCode('س = أدخل("اسمك: ")\nاطبع("أهلا", س)\n');
await page.keyboard.press("Control+Enter");
await page.waitForSelector("#input-row:not([hidden])", { timeout: 20000 });
await page.fill("#input", "سارة");
await page.press("#input", "Enter");
await page.waitForFunction(() => /انتهى/.test(document.getElementById("output").innerText));
o = await out();
check("input()", o.includes("اسمك: سارة") && o.includes("أهلا سارة"), JSON.stringify(o));

// 3. error line highlight
await setCode('س = ١\n\nاطبع(ص)\n');
await runAndWait();
o = await out();
const errLine = await page.locator(".cm-error-line").innerText().catch(() => "");
check("arabic error", o.includes("خطأ_اسم") && o.includes("السطر 3"), JSON.stringify(o));
check("error line highlighted", errLine.includes("اطبع(ص)"), JSON.stringify(errLine));

// 4. infinite loop + stop
await setCode('ع = ٠\nطالما صح:\n    ع += ١\n');
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(1500);
await page.click("#stop");
await page.waitForFunction(() => document.getElementById("status-text").textContent === "جاهز", null, { timeout: 60000 });
await setCode('اطبع("بعد الإيقاف")\n');
await runAndWait();
check("stop + restart", (await out()).includes("بعد الإيقاف"));

// 5. python tab
await setCode('لكل س في مدى(٣):\n    اطبع(س)\n');
await page.click("#tab-python");
await page.waitForFunction(() => document.querySelector("#python .cm-content")?.innerText.includes("for"), null, { timeout: 10000 });
const py = await page.locator("#python .cm-content").innerText();
check("python panel", py.includes("for س in range(3):") && py.includes("print(س)"), JSON.stringify(py));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-python.png` });
await page.click("#tab-output");

// 6. tour example (async, match, classes...)
await page.selectOption("#examples", "tour.af");
await runAndWait();
o = await out();
check("tour example", o.includes("تمت الجولة بنجاح"), JSON.stringify(o.slice(-300)));
const dirs = await page.evaluate(() => [...document.querySelectorAll("#output .line")].map(l => [l.getAttribute("dir"), l.textContent]));
const listLine = dirs.find(([, t]) => t.startsWith("['أ اكتملت'"));
const arabicLine = dirs.find(([, t]) => t.startsWith("تمت الجولة"));
check("output line directions", listLine?.[0] === "ltr" && arabicLine?.[0] === null, JSON.stringify([listLine, arabicLine]));
await setCode('اطبع("أ")\nاطبع()\nاطبع("ب")\n');
await runAndWait();
const lines = await page.evaluate(() => [...document.querySelectorAll("#output .line")].map(l => l.textContent));
check("empty print() line kept", JSON.stringify(lines) === JSON.stringify(["أ", "", "ب"]), JSON.stringify(lines));
await page.selectOption("#examples", "tour.af");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-tour.png` });

// 7. highlighting classes present
const tokClasses = await page.evaluate(() => [...new Set([...document.querySelectorAll(".cm-content span[class]")].map(s => s.className))].length);
check("syntax highlighting", tokClasses >= 8, `classes=${tokClasses}`);

// 8. autocomplete
await setCode("");
await page.keyboard.type("اط");
await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 5000 }).catch(() => {});
const ac = await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "");
check("autocomplete", ac.includes("اطبع") && ac.includes("print"), JSON.stringify(ac.slice(0, 60)));
await page.keyboard.press("Escape");
// hamza-insensitive: type "اذ" should propose إذا
await page.keyboard.press("Control+A"); await page.keyboard.press("Delete");
await page.keyboard.type("اذ");
await page.waitForTimeout(300);
const ac2 = await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "");
check("autocomplete hamza", ac2.includes("إذا"), JSON.stringify(ac2.slice(0, 60)));
await page.keyboard.press("Escape");

// 9. auto-indent after colon
await page.keyboard.press("Control+A"); await page.keyboard.press("Delete");
await page.keyboard.type("إذا صح:");
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
await page.keyboard.type("اطبع(1)");
await page.keyboard.press("Escape");
const doc = await page.locator(".cm-content").first().innerText();
check("auto indent", doc.includes("\n    اطبع(1)"), JSON.stringify(doc));

// 10. share link round trip
await setCode('اطبع("مشاركة ✓")\n');
await page.click("#share");
await page.waitForTimeout(500);
const shared = page.url();
const page2 = await ctx.newPage();
await page2.goto(shared);
await page2.waitForSelector(".cm-content");
const doc2 = await page2.locator(".cm-content").first().innerText();
check("share link", shared.includes("#code=") && doc2.includes('اطبع("مشاركة ✓")'), shared.slice(0, 90));

// 11. autosave
await page2.close();
const page3 = await ctx.newPage();
await page3.goto(URL);
await page3.waitForSelector(".cm-content");
check("autosave", (await page3.locator(".cm-content").first().innerText()).includes("مشاركة ✓"));

// 12. dark + mobile screenshots
await page3.click("#theme");
if (SHOTS) await page3.screenshot({ path: `${SHOTS}/shot-dark.png` });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(URL);
await mp.waitForSelector(".cm-content");
if (SHOTS) await mp.screenshot({ path: `${SHOTS}/shot-mobile.png`, fullPage: true });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check("mobile no horizontal scroll", !overflow);

console.log(results.join("\n"));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
const failed = results.filter((r) => r.startsWith("FAIL")).length;
if (failed || errors.length) {
  console.error(`${failed} فحص فشل، ${errors.length} خطأ في وحدة التحكم`);
  process.exit(1);
}
