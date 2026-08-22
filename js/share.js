/**
 * 会话分享：把模块 / 参数 / 问题描述编入 URL hash
 */

const PREFIX = "#s=";

export function encodeSession(session) {
  const json = JSON.stringify({
    v: 1,
    type: session.type,
    nl: session.nl || "",
    fields: session.fields || {},
    compare: !!session.compare,
    sweep: session.sweep || null,
  });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `${location.pathname}${location.search}${PREFIX}${b64}`;
}

export function decodeSessionFromLocation() {
  const hash = location.hash || "";
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const b64 = hash.slice(PREFIX.length);
    const json = decodeURIComponent(escape(atob(b64)));
    const o = JSON.parse(json);
    if (!o || o.v !== 1 || !o.type) return null;
    return o;
  } catch {
    return null;
  }
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
