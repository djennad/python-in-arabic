// ترميز البرامج في الروابط: #code=z<deflate-raw بصيغة base64url>
// (afaa/cli.py يستخدم الترميز نفسه في الأمر afaa --web)

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

export async function encodeCode(code) {
  const bytes = new TextEncoder().encode(code);
  if (typeof CompressionStream === "function") {
    return "z" + toBase64Url(await transform(bytes, new CompressionStream("deflate-raw")));
  }
  return "p" + toBase64Url(bytes);
}

export async function decodeCode(value) {
  const bytes = fromBase64Url(value.slice(1));
  const raw = value[0] === "z" ? await transform(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return new TextDecoder().decode(raw);
}

// البرنامج من رابط الصفحة الحالية (أو null)
export async function codeFromHash() {
  const match = /#code=([\w-]+)/.exec(location.hash);
  return match ? decodeCode(match[1]) : null;
}

// رابط صفحة في الموقع نفسه (مثل app.html) يحمل البرنامج
export async function linkTo(page, code) {
  const base = new URL(page, location.href);
  base.hash = `code=${await encodeCode(code)}`;
  return base.href;
}
