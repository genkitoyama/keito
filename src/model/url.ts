/**
 * The link a typed-in address stands for, or undefined when it is not a web
 * address. Only http(s) is let through: these end up as real links in
 * exported SVG and PDF files, where a `javascript:` URL would run.
 */
export function safeUrl(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (!s || /\s/.test(s)) return undefined;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(full);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? u.href : undefined;
  } catch {
    return undefined;
  }
}
