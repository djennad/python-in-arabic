// تصدير التطبيق كموقع مستقل: ملف zip يحتوي صفحة التطبيق وبيئة التشغيل كاملة
// (بايثون وأفعى والخطوط) مع البرنامج نفسه، فيعمل على أي استضافة ملفات ثابتة.

import { zipSync, strToU8 } from "fflate";

// الملفات المضغوطة أصلًا لا فائدة من ضغطها مرة أخرى
const STORED = /\.(zip|woff2?|png|jpe?g)$/i;

function readme(title, kind) {
  const runtime = kind === "streamlit"
    ? "streamlit/    بايثون ومكتبة ستريمليت للمتصفح (stlite).\nafaa.zip      لغة أفعى ومكتبة «ستريمليت» العربية."
    : "pyodide/      بايثون للمتصفح.\nafaa.zip      لغة أفعى ومكتبة «واجهات».";
  return `${title}
${"=".repeat(Math.max(title.length, 10))}

هذا الموقع تطبيق مكتوب بلغة أفعى، ويعمل بالكامل في متصفح الزائر
(لا يحتاج خادمًا ولا قاعدة بيانات).

الملفات
-------
program.af    برنامجك. عدّله ثم أعد رفع الموقع لتحديث التطبيق.
index.html    صفحة التطبيق.
${runtime}

التجربة على جهازك
-----------------
المتصفحات لا تشغّل هذا الموقع بفتح index.html مباشرة، بل عبر خادم:
    python3 -m http.server 8000
ثم افتح http://localhost:8000

النشر على الإنترنت (مجانًا)
--------------------------
GitHub Pages:
    1. أنشئ مستودعًا عامًا جديدًا على GitHub.
    2. ارفع محتويات هذا المجلد إليه (Add file ← Upload files).
    3. Settings ← Pages ← Source: Deploy from a branch ← main ← Save.
    4. بعد دقيقة يصبح الموقع على https://اسمك.github.io/اسم-المستودع/

Netlify:
    اسحب هذا المجلد وأفلته في https://app.netlify.com/drop

صُنع بلغة أفعى: https://github.com/djennad/python-in-arabic
`;
}

function fileName(title) {
  const clean = (title || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-");
  return `${clean || "تطبيق-أفعى"}.zip`;
}

export async function exportSite(code, title, kind = "app") {
  const manifest = await (await fetch(kind === "streamlit" ? "standalone-streamlit.json" : "standalone.json")).json();
  const files = {};
  await Promise.all(manifest.map(async ({ from, to }) => {
    const response = await fetch(from);
    if (!response.ok) throw new Error(`تعذّر تحميل ${from}`);
    const data = new Uint8Array(await response.arrayBuffer());
    files[to] = STORED.test(to) ? [data, { level: 0 }] : data;
  }));

  const appTitle = (title || "").trim() || "تطبيق أفعى";
  const escaped = appTitle.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const page = new TextDecoder().decode(files["index.html"]);
  files["index.html"] = strToU8(page.replace(/<title>[^<]*<\/title>/, `<title>${escaped}</title>`));
  files["program.af"] = strToU8(code);
  // رابط «عرض الشيفرة» يفتح البرنامج في هذا المحرر
  files["config.json"] = strToU8(JSON.stringify({
    editor: new URL("./", location.href).href,
    title: appTitle,
  }, null, 2));
  files["اقرأني.txt"] = strToU8(readme(appTitle, kind));
  files[".nojekyll"] = new Uint8Array();

  const zip = zipSync(files, { level: 6 });
  const name = fileName(title);
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
