let ctx: CanvasRenderingContext2D | null | undefined;

/** Text width in px for a CSS font shorthand. Falls back to an estimate outside the browser. */
export function measure(text: string, font: string): number {
  if (ctx === undefined) {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!ctx) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
    let w = 0;
    for (const ch of text) w += ch.charCodeAt(0) > 0xff ? size : size * 0.58;
    return w;
  }
  ctx.font = font;
  return ctx.measureText(text).width;
}

const cache = new Map<string, string[]>();
/** Characters that must not start a line (Japanese kinsoku). */
const NO_START = /^[、。，．,.！？!?）)」』】〉》｝\]ー…‥・：；:;ゃゅょっぁぃぅぇぉャュョッァィゥェォ々〜]/;

/** Greedy wrap: latin words stay whole, CJK breaks per character. */
export function wrapText(text: string, maxWidth: number, font: string): string[] {
  const key = `${font}|${Math.round(maxWidth)}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(/[\x21-\x7e]+|\s+|[^\x20-\x7e]/g) ?? [];
    let line = '';
    for (const tok of tokens) {
      const overflow = line !== '' && measure(line + tok, font) > maxWidth;
      if (overflow && NO_START.test(tok) && line.length > 1) {
        // Punctuation may not start a line: carry the preceding character down
        // with it, the same way the browser's `line-break: strict` does.
        out.push(line.slice(0, -1).trimEnd());
        line = line.slice(-1) + tok;
      } else if (overflow) {
        out.push(line.trimEnd());
        line = tok.trim() ? tok : '';
      } else {
        line += tok;
      }
      // A single token wider than the box is split per character.
      while (measure(line, font) > maxWidth && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && measure(line.slice(0, n), font) > maxWidth) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}
