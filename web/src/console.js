// لوحة المخرجات: تعرض ما يطبعه البرنامج سطرًا سطرًا مع مراعاة اتجاه النص.

// أسطر المخرجات التي تبدأ بقوس أو علامة اقتباس أو رقم (مثل [١، ٢] أو ('أ', 3))
// هي تمثيلات بايثون فتُعرض من اليسار لليمين حتى لا تنقلب الأقواس
const CODE_LIKE = /^\s*[[({'"0-9a-zA-Z<-]/;
// عزل النصوص المقتبسة في الأسطر البرمجية حتى لا تقلب خوارزمية الاتجاه
// ترتيب الأرقام والأقواس بين كلمتين عربيتين، مثل [('ا', 3), ('م', 2)]
const QUOTED = /('[^'\n]*'|"[^"\n]*")/;
const MAX_LINES = 5000;

export class OutputConsole {
  constructor(element) {
    this.element = element;
    this.pending = [];
    this.scheduled = false;
    this.currentLine = null;
  }

  append(text, cls) {
    this.pending.push([text, cls]);
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  newLine() {
    this.currentLine = document.createElement("div");
    this.currentLine.className = "line";
    this.element.appendChild(this.currentLine);
  }

  static direction(line) {
    if (CODE_LIKE.test(line.textContent)) line.setAttribute("dir", "ltr");
    else line.removeAttribute("dir");
  }

  static isolateQuoted(line) {
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

  flush() {
    this.scheduled = false;
    if (!this.pending.length) return;
    const el = this.element;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.querySelector(".placeholder")?.remove();
    for (const [text, cls] of this.pending) {
      text.split("\n").forEach((part, index) => {
        if (index > 0) {
          // نهاية سطر: نغلق السطر المفتوح (أو ننشئ سطرًا فارغًا)
          if (!this.currentLine) this.newLine();
          OutputConsole.direction(this.currentLine);
          OutputConsole.isolateQuoted(this.currentLine);
          this.currentLine = null;
        }
        if (!part) return;
        if (!this.currentLine) this.newLine();
        const span = document.createElement("span");
        if (cls) span.className = cls;
        span.textContent = part;
        this.currentLine.appendChild(span);
      });
    }
    if (this.currentLine) OutputConsole.direction(this.currentLine);
    this.pending = [];
    while (el.childNodes.length > MAX_LINES) el.firstChild.remove();
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }

  meta(text) {
    this.flush();
    this.currentLine = null;
    const div = document.createElement("div");
    div.className = "meta";
    div.textContent = text;
    this.element.appendChild(div);
    this.element.scrollTop = this.element.scrollHeight;
  }

  clear() {
    this.pending = [];
    this.currentLine = null;
    this.element.textContent = "";
  }

  get empty() {
    return !this.element.querySelector(".line");
  }
}
