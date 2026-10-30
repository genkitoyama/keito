let ctx: CanvasRenderingContext2D | null | undefined;

/** The typeface the board is drawn in, on screen and in every export. */
export const UI_FONT = '-apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif';
/** Fixed-width type for addresses, so the digits of one IP line up under another's. */
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

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

/** Where a name reads best broken: at a space, before an opening bracket, after a closing one. */
const STRONG_BEFORE = /[（(［[「『【〈《]/;
const STRONG_AFTER = /[）)］\]」』】〉》]/;
/** Where it may break if it must: after a separator (床・左側, A／B, 下手、上手). */
const WEAK_AFTER = /[・／/、，,]/;

/** Pieces of a name between the places it may break, at the strong ones only or at the weak ones too. */
function pieces(text: string, weak: boolean): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (cur && (/\s/.test(ch) || STRONG_BEFORE.test(ch))) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
    if (/\s/.test(ch) || STRONG_AFTER.test(ch) || (weak && WEAK_AFTER.test(ch))) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The lines with the widest as narrow as can be, from whole pieces: null when a piece is wider
 * than the box or it takes more lines than `most`.
 */
function evenLines(parts: string[], maxWidth: number, font: string, most: number): string[] | null {
  // best[i]: the fewest lines, then the narrowest widest one, for parts[i..].
  const best: ({ lines: string[]; widest: number } | null)[] = Array(parts.length + 1).fill(null);
  best[parts.length] = { lines: [], widest: 0 };
  for (let i = parts.length - 1; i >= 0; i--) {
    for (let j = i + 1; j <= parts.length; j++) {
      const line = parts.slice(i, j).join('').trim();
      const w = measure(line, font);
      if (w > maxWidth) break;
      const rest = best[j];
      if (!rest || !line) continue;
      const cand = { lines: [line, ...rest.lines], widest: Math.max(w, rest.widest) };
      const cur = best[i];
      if (!cur || cand.lines.length < cur.lines.length || (cand.lines.length === cur.lines.length && cand.widest < cur.widest)) best[i] = cand;
    }
  }
  const found = best[0];
  return found && found.lines.length <= most ? found.lines : null;
}

/**
 * A device's name wrapped as a person would break it: "HDBaseT 送信機 / （ステージ下手側）" rather
 * than "HDBaseT 送信機（ステー / ジ下手側）", the lines kept about as long as each other. Never
 * on more lines than the plain wrap; a name that cannot be broken so is wrapped the plain way.
 */
export function wrapName(text: string, maxWidth: number, font: string): string[] {
  const plain = wrapText(text, maxWidth, font);
  if (plain.length < 2) return plain;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const most = wrapText(para, maxWidth, font).length;
    const lines = most < 2 ? null : evenLines(pieces(para, false), maxWidth, font, most) ?? evenLines(pieces(para, true), maxWidth, font, most);
    out.push(...(lines ?? wrapText(para, maxWidth, font)));
  }
  return out;
}
