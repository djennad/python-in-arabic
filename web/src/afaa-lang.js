// دعم لغة أفعى في محرر CodeMirror: التلوين، والإزاحة التلقائية، والإكمال التلقائي.
// كل الكلمات تأتي من vocabulary.json المولَّد من afaa/vocabulary.py.

import { StreamLanguage, LanguageSupport, indentService, indentUnit } from "@codemirror/language";
import { snippetCompletion } from "@codemirror/autocomplete";

// نفس قواعد التطبيع في afaa/vocabulary.py
const MARKS = /[ً-ٰٟـ]/g;
const LETTERS = { "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه" };
export function normalize(word) {
  return word.replace(MARKS, "").replace(/[أإآٱىة]/g, (c) => LETTERS[c]);
}

const TOKEN_FOR_KIND = {
  keyword: "keyword",
  constant: "bool",
  self: "self",
  builtin: "variableName.standard",
  exception: "className.standard",
  dunder: "variableName.special",
  method: "propertyName",
  library: "namespace",
};

const COMPLETION_TYPE = {
  keyword: "keyword",
  constant: "constant",
  self: "variable",
  builtin: "function",
  exception: "class",
  dunder: "method",
  method: "method",
  library: "namespace",
};

const DEFINERS = { def: "variableName.definition", class: "className.definition" };

const IDENT_START = /[\p{L}_]/u;
const IDENT = /^[\p{L}_][\p{L}\p{M}\p{N}_]*/u;
const NUMBER = /^(?:0[xXoObB][0-9a-fA-F_]+|[0-9٠-٩۰-۹][0-9٠-٩۰-۹_٬]*(?:[.٫][0-9٠-٩۰-۹_]*)?(?:[eE][+-]?[0-9٠-٩۰-۹_]+)?[jJ]?|[.٫][0-9٠-٩۰-۹][0-9٠-٩۰-۹_]*)/;
const STRING_START = /^([rRbBuUfFtT]{0,2})("""|'''|"|'|«)/;

function buildLookup(vocabulary) {
  const lookup = new Map();
  for (const category of vocabulary.categories) {
    for (const entry of category.entries) {
      for (const arabic of entry.arabic) {
        const key = normalize(arabic);
        if (!lookup.has(key)) lookup.set(key, entry);
      }
    }
  }
  return lookup;
}

function tokenString(stream, state) {
  const { delim } = state;
  const closing = delim === "«" ? "»" : delim;
  while (!stream.eol()) {
    if (stream.match(closing)) {
      state.delim = null;
      return "string";
    }
    const ch = stream.next();
    if (ch === "\\" && !state.raw) stream.next();
  }
  // النص العادي غير المغلق ينتهي بنهاية السطر
  if (closing.length === 1) state.delim = null;
  return "string";
}

function afaaStreamParser(lookup) {
  return {
    name: "afaa",
    startState: () => ({ delim: null, raw: false, expect: null }),
    copyState: (s) => ({ ...s }),
    token(stream, state) {
      if (state.delim) return tokenString(stream, state);
      if (stream.eatSpace()) return null;

      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      const str = stream.match(STRING_START);
      if (str) {
        state.delim = str[2];
        state.raw = /r/i.test(str[1]);
        state.expect = null;
        return tokenString(stream, state);
      }
      if (stream.match(NUMBER)) {
        state.expect = null;
        return "number";
      }
      if (IDENT_START.test(stream.peek())) {
        const word = stream.match(IDENT)[0];
        if (state.expect) {
          const tok = state.expect;
          state.expect = null;
          return tok;
        }
        const entry = lookup.get(normalize(word));
        if (!entry) {
          // اسم متبوع بقوس فتح: استدعاء دالة
          return stream.match(/^\s*\(/, false) ? "variableName.function" : "variableName";
        }
        if (DEFINERS[entry.python]) state.expect = DEFINERS[entry.python];
        return TOKEN_FOR_KIND[entry.kind] || "variableName";
      }
      if (stream.match(/^@[\p{L}_][\p{L}\p{M}\p{N}_.]*/u)) return "meta";
      if (stream.match(/^(?:\*\*=?|\/\/=?|->|:=|[-+*/%@&|^~<>=!]=?)/)) return "operator";
      if (stream.match(/^[()[\]{}]/)) return "bracket";
      stream.next();
      return "punctuation";
    },
    languageData: {
      commentTokens: { line: "#" },
      closeBrackets: { brackets: ["(", "[", "{", "'", '"', "«"] },
    },
  };
}

// الإزاحة: +٤ بعد سطر ينتهي بنقطتين، و-٤ بعد أرجع/مرر/اكسر/استمر/ارفع
function afaaIndent(lookup) {
  const DEDENT_AFTER = new Set(["return", "pass", "break", "continue", "raise"]);
  return indentService.of((context, pos) => {
    const current = context.lineAt(pos, 1);
    if (current.from === 0) return 0;
    // أقرب سطر غير فارغ قبل السطر الحالي
    let prev = context.lineAt(current.from - 1, -1);
    while (!prev.text.trim() && prev.from > 0) prev = context.lineAt(prev.from - 1, -1);
    const base = /^\s*/.exec(prev.text)[0].replace(/\t/g, "    ").length;
    const code = prev.text.replace(/#.*$/, "").trimEnd();
    if (code.endsWith(":")) return base + context.unit;
    const first = (IDENT.exec(code.trimStart()) || [""])[0];
    const entry = lookup.get(normalize(first));
    if (entry && DEDENT_AFTER.has(entry.python)) return Math.max(0, base - context.unit);
    return base;
  });
}

const SNIPPETS = [
  ["إذا ${الشرط}:\n\t${}", "إذا", "جملة شرطية"],
  ["إذا ${الشرط}:\n\t${}\nوإلا:\n\t${}", "إذا/وإلا", "جملة شرطية مع بديل"],
  ["لكل ${عنصر} في ${مدى(١٠)}:\n\t${}", "لكل", "حلقة تكرار"],
  ["طالما ${الشرط}:\n\t${}", "طالما", "حلقة شرطية"],
  ["دالة ${الاسم}(${المعاملات}):\n\t${مرر}", "دالة", "تعريف دالة"],
  ["صنف ${الاسم}:\n\tدالة __تهيئة__(ذات${}):\n\t\t${مرر}", "صنف", "تعريف صنف"],
  ["حاول:\n\t${}\nباستثناء ${استثناء} باسم خ:\n\t${اطبع(خ)}", "حاول", "معالجة الأخطاء"],
  ["مع ${افتح(\"ملف.txt\")} باسم ${م}:\n\t${}", "مع", "مدير سياق"],
  ["إذا __اسم__ == \"__رئيسي__\":\n\t${}", "رئيسي", "نقطة بداية البرنامج"],
];

function afaaCompletions(vocabulary) {
  const options = [];
  for (const category of vocabulary.categories) {
    for (const entry of category.entries) {
      entry.arabic.forEach((arabic, index) => {
        options.push({
          label: arabic,
          detail: entry.python,
          type: COMPLETION_TYPE[entry.kind],
          boost: index === 0 ? (entry.kind === "keyword" || entry.kind === "builtin" ? 2 : 0) : -5,
          key: normalize(arabic),
        });
      });
    }
  }
  const snippets = SNIPPETS.map(([template, label, detail]) => ({
    ...snippetCompletion(template, { label, detail, type: "text", boost: 3 }),
    key: normalize(label),
  }));

  return (context) => {
    const word = context.matchBefore(/[\p{L}\p{M}\p{N}_]+/u);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const typed = normalize(word.text);
    // كلمات المستند نفسه (المتغيرات والدوال التي كتبها المستخدم)
    const seen = new Set();
    const docWords = [];
    const text = context.state.doc.toString();
    for (const match of text.matchAll(/[\p{L}_][\p{L}\p{M}\p{N}_]*/gu)) {
      const w = match[0];
      if (w !== word.text && w.length > 1 && !seen.has(w)) {
        seen.add(w);
        docWords.push({ label: w, type: "variable", key: normalize(w), boost: 1 });
      }
    }
    const result = [];
    for (const option of [...snippets, ...options, ...docWords]) {
      if (option.key.startsWith(typed)) result.push(option);
    }
    return { from: word.from, options: result, filter: false, validFor: /^[\p{L}\p{M}\p{N}_]*$/u };
  };
}

export function afaa(vocabulary) {
  const lookup = buildLookup(vocabulary);
  const language = StreamLanguage.define(afaaStreamParser(lookup));
  return new LanguageSupport(language, [
    afaaIndent(lookup),
    indentUnit.of("    "),
    language.data.of({ autocomplete: afaaCompletions(vocabulary) }),
  ]);
}
