import { UI_FONT, measure, wrapText } from './text';

/**
 * Sequence diagram source. keito's own short form is a subset of Mermaid's; whole Mermaid
 * (`sequenceDiagram`) and PlantUML (`@startuml`) sequence diagrams are read as well:
 *   title: 認証フロー
 *   participant API as API Server        (PlantUML: participant "API Server" as API)
 *   App -> API: リクエスト
 *   API --> App: レスポンス               (dashed = return; PlantUML's <- reverses)
 *   note over App, API: メモ              (PlantUML: a note over several lines, up to "end note")
 *   loop 3回 … end / alt … else … end    (framed round their rows; == 区切り == and ... 待ち ... are dividers)
 *   autonumber                           (numbers the messages)
 */
export interface SeqParticipant {
  id: string;
  label: string;
}
export type SeqItem =
  /** `num`: its number under autonumber, already at the head of `text`. */
  | { kind: 'msg'; from: number; to: number; text: string; dashed: boolean; cross?: boolean; num?: number }
  | { kind: 'note'; over: number; to?: number; text: string }
  /** A divider across the diagram: the start of a block (loop, alt …) with its label, or its end. */
  | { kind: 'section'; text: string; end?: boolean };

export interface SeqDiagram {
  title: string;
  participants: SeqParticipant[];
  items: SeqItem[];
  w: number;
  h: number;
}

export const SEQ = { col: 170, boxW: 130, boxH: 34, step: 42, padX: 20, padTop: 16, titleH: 26, minCol: 90, minStep: 26 };

export interface SeqLayout {
  w: number;
  h: number;
  /** Width given to each participant, and the distance between messages. */
  col: number;
  step: number;
}

/**
 * How big the diagram is drawn. Without a size of its own it takes its natural size; resized by
 * hand, the columns and rows stretch or squeeze to fill it, down to what stays readable.
 */
export function seqLayout(text: string, w = 0, h = 0, k = 1): SeqLayout {
  const d = parseSequence(text);
  const n = Math.max(1, d.participants.length);
  const head = (SEQ.padTop + (d.title ? SEQ.titleH : 0) + SEQ.boxH) * k;
  const col = w > 0 ? Math.max(SEQ.minCol * k, (w - SEQ.padX * 2 * k) / n) : SEQ.col * k;
  const lines = seqLines(d, col, k);
  const total = (step: number) => seqRows(d, lines, k, step).total;
  let step = SEQ.step * k;
  if (h > 0) {
    // Resized by hand: the row spacing that fills the height (rows with more text keep their extra room).
    let [lo, hi] = [SEQ.minStep * k, Math.max(SEQ.minStep * k, h)];
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (head + total(m) > h) hi = m;
      else lo = m;
    }
    step = lo;
  }
  return { col, step, w: SEQ.padX * 2 * k + n * col, h: head + total(step) };
}

/** Line height of the diagram's text, as a share of its size. */
export const SEQ_LINE = 1.4;

/** How wide a message's or a note's text may run in columns `col` apart, as drawn. */
export function seqTextWidth(it: SeqItem, col: number, k: number): number {
  if (it.kind === 'msg') return Math.abs(it.to - it.from) * col - 12;
  if (it.kind !== 'note') return Infinity;
  // A note over two participants spans them both; one over one takes what its text needs, up to its column.
  const span = Math.abs((it.to ?? it.over) - it.over) * col;
  return Math.max(Math.min(col - 12, measure(it.text, `${SEQ_TEXT * k}px ${UI_FONT}`) + 18 * k), span + col * 0.6 - 12) - 8;
}

/** Each item's text as drawn, line by line: wrapped to the room it has (a message to itself runs free to the right). */
export function seqLines(d: SeqDiagram, col: number, k: number): string[][] {
  return d.items.map((it) => {
    if ((it.kind === 'msg' && it.from !== it.to) || it.kind === 'note') return wrapText(it.text, seqTextWidth(it, col, k), `${SEQ_TEXT * k}px ${UI_FONT}`);
    return [it.text];
  });
}

/** A note's box: tall enough for its lines. */
const noteHeight = (lines: number, k: number): number => Math.max(26 * k, lines * SEQ_TEXT * k * SEQ_LINE + 10 * k);

/**
 * How tall an item's row is with rows `step` apart: a message whose text runs to several lines
 * gets the extra lines on top (its text stacks up above the arrow), a note at least its box and a
 * little air, so nothing covers its neighbours however close the rows are.
 */
function rowHeight(it: SeqItem, lines: number, k: number, step: number): number {
  if (it.kind === 'note') return Math.max(step, noteHeight(lines, k) + 12 * k);
  if (it.kind === 'msg' && it.from !== it.to) return step + (lines - 1) * SEQ_TEXT * k * SEQ_LINE;
  return step;
}

/**
 * Where each item sits below the top of the lifelines (its row's centre), and how tall all the rows
 * are, half a row of air above the first and below the last included.
 */
export function seqRows(d: SeqDiagram, lines: string[][], k: number, step: number): { at: number[]; total: number } {
  const at: number[] = [];
  let used = step / 2;
  d.items.forEach((it, i) => {
    const h = rowHeight(it, lines[i]?.length ?? 1, k, step);
    at.push(used + h / 2);
    used += h;
  });
  return { at, total: used + step / 2 };
}

/** One item as drawn: the line it runs along (a message's arrow, a note's or a divider's centre), its text, and the top and bottom of all it draws. */
export interface SeqPlaced {
  y: number;
  lines: string[];
  /** Where its text is centred (a message's sits above its arrow). */
  textY: number;
  top: number;
  bottom: number;
}

/** Where everything of a diagram on the board is drawn: what the renderer draws and a highlighted row covers. */
export function seqPlace(n: { x: number; y: number; w: number; h: number; text: string; fontSize?: number }): { d: SeqDiagram; k: number; layout: SeqLayout; lifeTop: number; items: SeqPlaced[] } {
  const d = parseSequence(n.text);
  const k = seqScale(n.fontSize);
  const layout = seqLayout(n.text, n.w, n.h, k);
  const { col, step } = layout;
  const lifeTop = n.y + (SEQ.padTop + (d.title ? SEQ.titleH : 0) + SEQ.boxH) * k;
  const lines = seqLines(d, col, k);
  const rows = seqRows(d, lines, k, step);
  const text = SEQ_TEXT * k;
  const lh = text * SEQ_LINE;
  const items = d.items.map((it, i): SeqPlaced => {
    const centre = lifeTop + rows.at[i];
    const L = lines[i];
    if (it.kind === 'msg' && it.from !== it.to) {
      // The arrow at the foot of the item's row, its text stacked up above it.
      const y = centre + (rowHeight(it, L.length, k, step) - step) / 2;
      const textY = y - 10 * k - ((L.length - 1) * lh) / 2;
      return { y, lines: L, textY, top: textY - (L.length * lh) / 2, bottom: y + 5 * k };
    }
    if (it.kind === 'msg') return { y: centre, lines: L, textY: centre, top: centre - 10 * k, bottom: centre + 10 * k };
    if (it.kind === 'note') {
      const h = noteHeight(L.length, k);
      return { y: centre, lines: L, textY: centre, top: centre - h / 2, bottom: centre + h / 2 };
    }
    return { y: centre, lines: L, textY: centre, top: centre - 9 * k, bottom: centre + 9 * k };
  });
  return { d, k, layout, lifeTop, items };
}

/** What an item says, independent of where it sits: how a comment pinned to it finds it again. */
export function seqSig(d: SeqDiagram, it: SeqItem): string {
  const who = (i?: number): string => (i === undefined ? '' : (d.participants[i]?.id ?? ''));
  // Without its number: one line added above renumbers everything after it.
  if (it.kind === 'msg') return `msg|${who(it.from)}|${who(it.to)}|${it.num ? it.text.slice(`${it.num}. `.length) : it.text}`;
  if (it.kind === 'note') return `note|${who(it.over)}|${who(it.to)}|${it.text}`;
  return `section|${it.end ? 'end' : ''}|${it.text}`;
}

/** An item in words, for a list: "制御PC → プロジェクター: 電源ON". */
export function seqDescribe(d: SeqDiagram, i: number): string {
  const it = d.items[i];
  if (!it) return '';
  const who = (j: number): string => d.participants[j]?.label ?? '';
  if (it.kind === 'msg') return `${who(it.from)} → ${who(it.to)}${it.text ? `: ${it.text}` : ''}`;
  if (it.kind === 'note') return `ノート: ${it.text.replace(/\n/g, ' ')}`;
  return it.end ? '（ブロックの終わり）' : it.text;
}

/**
 * The band each item takes across the diagram, in board coordinates: its centre line and height.
 * It covers what the item draws — a message's text above its arrow, a note, a block's label — with
 * a little room, so a highlighted row never cuts its text or reaches into the next one when the
 * rows are squeezed.
 */
export function seqBands(n: { x: number; y: number; w: number; h: number; text: string; fontSize?: number }): { y: number; h: number }[] {
  const { k, items } = seqPlace(n);
  const pad = 3 * k;
  return items.map((it) => ({ y: (it.top + it.bottom) / 2, h: it.bottom - it.top + pad * 2 }));
}

/**
 * Where item `i` of the old source is in the new one, or -1 if it is gone. Unchanged items are
 * matched in order (longest common run); an item edited in place — the same number of items
 * between the same unchanged neighbours, and the same kind — is followed too.
 */
export function seqFollow(before: string, after: string, i: number): number {
  if (before === after) return i;
  const a = parseSequence(before);
  const b = parseSequence(after);
  if (i < 0 || i >= a.items.length) return -1;
  const sa = a.items.map((it) => seqSig(a, it));
  const sb = b.items.map((it) => seqSig(b, it));
  const n = sa.length;
  const m = sb.length;
  // LCS table from the end, so matching walks forward.
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) t[x][y] = sa[x] === sb[y] ? t[x + 1][y + 1] + 1 : Math.max(t[x + 1][y], t[x][y + 1]);
  const pairs: [number, number][] = [];
  for (let x = 0, y = 0; x < n && y < m; ) {
    if (sa[x] === sb[y]) pairs.push([x++, y++]);
    else if (t[x + 1][y] >= t[x][y + 1]) x++;
    else y++;
  }
  const hit = pairs.find(([x]) => x === i);
  if (hit) return hit[1];
  // The gap between the matched neighbours around i, in both.
  let lo: [number, number] = [-1, -1];
  let hi: [number, number] = [n, m];
  for (const p of pairs) {
    if (p[0] < i) lo = p;
    else if (p[0] > i) {
      hi = p;
      break;
    }
  }
  const off = i - lo[0] - 1;
  if (hi[0] - lo[0] !== hi[1] - lo[1]) return -1;
  const j = lo[1] + 1 + off;
  return b.items[j]?.kind === a.items[i].kind ? j : -1;
}

/** The message text is 11px by default; a bigger text size scales the whole diagram with it. */
export const SEQ_TEXT = 11;
export const seqScale = (fontSize?: number): number => (fontSize ?? SEQ_TEXT) / SEQ_TEXT;

const cache = new Map<string, SeqDiagram>();

/** Lines that set up a diagram's look or behaviour in Mermaid or PlantUML (or fence it in Markdown), with nothing to draw here. */
// Keywords stand alone ("show" never eats "Showroom -> API"), and are only tried on lines without a
// message arrow, so a participant named Group, Header or End is never taken for one.
const IGNORED = /^(?:```|sequenceDiagram\b|@startuml\b|@enduml\b|skinparam\b|hide\b|show\b|!|\|\|\||activate\b|deactivate\b|destroy\b|create\b|autoactivate\b|newpage\b|scale\b|left to right\b|top to bottom\b|footer\b|header\b|legend\b|end legend\b)/i;
const BLOCK = /^(loop|alt|else|opt|par|and|critical|option|break|rect|group)(?:\s+(.*))?$/i;
/** A block's divider label, as parsed: the start of a block or a split inside one ("loop 3回", "else 失敗"). */
export const BLOCK_WORD = /^(loop|alt|else|opt|par|and|critical|option|break|rect|group)\b/i;
/** Words that split a block in parts (alt … else, par … and, critical … option) rather than start one. */
const SPLIT = /^(else|and|option)\b/i;

/** A block of rows (loop, alt …) as drawn: its first and closing rows, how deep it sits, and where it is split. */
export interface SeqBlock {
  kind: string;
  label: string;
  /** The row of its opening line, and of its `end` (the item count when it is never closed). */
  start: number;
  end: number;
  depth: number;
  splits: { at: number; label: string }[];
}

/** The blocks of a diagram, outer ones first, from its dividers. */
export function seqBlocks(d: SeqDiagram): SeqBlock[] {
  const open: SeqBlock[] = [];
  const done: SeqBlock[] = [];
  const words = (text: string) => {
    const [kind, ...rest] = text.split(' ');
    return { kind: kind.toLowerCase(), label: rest.join(' ').trim() };
  };
  d.items.forEach((it, i) => {
    if (it.kind !== 'section') return;
    if (it.end) {
      const b = open.pop();
      if (b) done.push({ ...b, end: i });
      return;
    }
    if (!BLOCK_WORD.test(it.text)) return;
    const { kind, label } = words(it.text);
    if (SPLIT.test(kind)) {
      open.at(-1)?.splits.push({ at: i, label: [kind === 'else' ? '' : kind, label].filter(Boolean).join(' ') || kind });
      return;
    }
    open.push({ kind, label, start: i, end: d.items.length, depth: open.length, splits: [] });
  });
  // Left open at the bottom: framed down to the end of the diagram.
  done.push(...open);
  return done.sort((a, b) => a.depth - b.depth || a.start - b.start);
}
/** A message: who, the arrow (keito and Mermaid "->>", "-x", "-)"; PlantUML "<-", "->x"), who, and its text. */
/** Arrows that point (they have < or >), and those that only end in a cross or a half head. */
const ARROWS = [/<->|<-->|-->>|->>|-->x|->x|-->|->|<--|<-/g, /--x|-x|--\)|-\)/g];

/**
 * A message line split into its sender, arrow, receiver and text, or null when it is not one. A
 * pointing arrow is looked for first, so a name with "-x" in it ("my-xbox -> TV") stays whole;
 * both ends must be named.
 */
function splitMessage(line: string): RegExpExecArray | null {
  const colon = line.search(/[:：]/);
  const head = colon < 0 ? line : line.slice(0, colon);
  const text = colon < 0 ? undefined : line.slice(colon + 1).trim();
  for (const arrows of ARROWS) {
    arrows.lastIndex = 0;
    for (let m = arrows.exec(head); m; m = arrows.exec(head)) {
      const from = head.slice(0, m.index).trim();
      // Activation marks (+/- before the receiver, ++/-- after it) are dropped.
      const to = head
        .slice(m.index + m[0].length)
        .trim()
        .replace(/^[+-]\s*/, '')
        .replace(/\s*(?:\+\+|--)$/, '')
        .trim();
      if (!from || !to) continue;
      return [line, from, m[0], to, text] as unknown as RegExpExecArray;
    }
  }
  return null;
}
const unquote = (s: string): string => s.trim().replace(/^"(.*)"$/, '$1').trim();

export function parseSequence(src: string): SeqDiagram {
  const hit = cache.get(src);
  if (hit) return hit;
  let title = '';
  const participants: SeqParticipant[] = [];
  const items: SeqItem[] = [];
  const index = (id: string): number => {
    const key = unquote(id);
    let i = participants.findIndex((p) => p.id === key);
    if (i < 0) {
      participants.push({ id: key, label: key });
      i = participants.length - 1;
    }
    return i;
  };
  let numbered = false;
  let count = 0;
  let last: { from: number; to: number } | null = null;
  // Mermaid boxes group participants; their "end" closes the box, not a block.
  let boxes = 0;
  const lines = src.split('\n');
  for (let at = 0; at < lines.length; at++) {
    // Accept what a Japanese IME tends to produce: ： → ⇢ and full-width spaces.
    const line = lines[at].replace(/　/g, ' ').replace(/⇢/g, '-->').replace(/→/g, '->').trim();
    if (!line || line.startsWith('#') || line.startsWith('%%') || line.startsWith("'")) continue;
    // PlantUML colours an arrow ("-[#red]>"): dropped before the text, which keeps its brackets.
    const colon = line.search(/[:：]/);
    const head = colon < 0 ? line : line.slice(0, colon);
    const plainLine = head.replace(/-\[[^\]]*\]/g, '-') + (colon < 0 ? '' : line.slice(colon));
    let m: RegExpExecArray | null;
    if ((m = /^title(?:\s*[:：]\s*|\s+)(.*)$/i.exec(line))) {
      title = m[1];
    } else if (/^autonumber\b/i.test(line)) {
      numbered = true;
    } else if ((m = /^(?:participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i.exec(line))) {
      // Mermaid names the id first ("API as API Server"); PlantUML may quote the label first ("\"API Server\" as API").
      const rest = m[1].replace(/\s+(?:order\s+\d+|#\S+)\s*$/i, '');
      const q = /^"([^"]+)"\s*(?:as\s+(\S+))?$/.exec(rest);
      const named = /^(\S+?)\s+as\s+(.+)$/.exec(rest);
      if (q) participants[index(q[2] ?? q[1])].label = q[1];
      else if (named) participants[index(named[1])].label = unquote(named[2]);
      else index(rest);
    } else if ((m = /^note\s+(?:over|left of|right of)\s+([^:：]*?)\s*(?:[:：]\s*(.*))?$/i.exec(line))) {
      // A PlantUML note may run over several lines, up to "end note" — only if one follows; a note
      // still being typed ("note over A") must not swallow the lines after it.
      let text = m[2] ?? '';
      if (m[2] === undefined) {
        const close = lines.findIndex((l, i) => i > at && /^\s*end\s*note\b/i.test(l));
        // Another note begun before that "end note" means this one is still being typed.
        const next = lines.findIndex((l, i) => i > at && /^\s*note\b/i.test(l));
        if (close > at && (next < 0 || next > close)) {
          text = lines
            .slice(at + 1, close)
            .map((l) => l.trim())
            .join('\n');
          at = close;
        }
      }
      const [a, b] = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (!a) continue;
      items.push({ kind: 'note', over: index(a), ...(b ? { to: index(b) } : {}), text });
    } else if ((m = splitMessage(plainLine)) && !/^(?:note|participant|actor)\s/i.test(line)) {
      // "<-" (PlantUML) points the other way; "x" ends lost; activation marks are dropped.
      const back = m[2].startsWith('<') && !m[2].endsWith('>');
      const from = index(back ? m[3] : m[1]);
      const to = index(back ? m[1] : m[3]);
      const num = numbered ? ++count : undefined;
      const text = (num ? `${num}. ` : '') + (m[4] ?? '');
      items.push({ kind: 'msg', from, to, text, dashed: m[2].includes('--'), ...(m[2].endsWith('x') ? { cross: true } : {}), ...(num ? { num } : {}) });
      last = { from, to };
    } else if (/^box\b/i.test(line)) {
      boxes++;
    } else if (/^end\s+box\b/i.test(line)) {
      boxes = Math.max(0, boxes - 1);
    } else if (IGNORED.test(line)) {
      continue;
    } else if ((m = /^==\s*(.*?)\s*==$/.exec(line)) || (m = /^\.\.\.\s*(.*?)\s*(?:\.\.\.)?$/.exec(line))) {
      items.push({ kind: 'section', text: m[1] || '…' });
    } else if ((m = BLOCK.exec(line))) {
      // A block's start (and a branch of it) is a divider with its keyword and label; colours of "rect" are no label.
      const label = m[1].toLowerCase() === 'rect' ? '' : (m[2] ?? '').trim();
      items.push({ kind: 'section', text: [m[1].toLowerCase(), label].filter(Boolean).join(' ') });
    } else if (/^end$/i.test(line)) {
      if (boxes > 0) boxes--;
      else items.push({ kind: 'section', text: '', end: true });
    } else if ((m = /^return(?:\s+(.*))?$/i.exec(line))) {
      // PlantUML's return answers the last message (with none before it, there is nothing to number).
      const num = numbered && last ? ++count : undefined;
      if (last) items.push({ kind: 'msg', from: last.to, to: last.from, text: (num ? `${num}. ` : '') + (m[1] ?? ''), dashed: true, ...(num ? { num } : {}) });
    }
  }
  const n = Math.max(1, participants.length);
  const d: SeqDiagram = {
    title,
    participants,
    items,
    w: SEQ.padX * 2 + n * SEQ.col,
    h: SEQ.padTop + (title ? SEQ.titleH : 0) + SEQ.boxH + (items.length + 1) * SEQ.step,
  };
  if (cache.size > 200) cache.clear();
  cache.set(src, d);
  return d;
}

export const SEQUENCE_SAMPLE = `title: 起動シーケンス
participant PC as 制御PC
participant PJ as プロジェクター
participant SV as コンテンツサーバー
PC -> PJ: 電源ON (PJLink)
PJ --> PC: OK
PC -> SV: 再生開始 (OSC)
note over SV: プリロード 3秒
SV --> PC: 再生中`;
