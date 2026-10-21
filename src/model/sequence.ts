/**
 * Sequence diagram source. keito's own short form is a subset of Mermaid's; whole Mermaid
 * (`sequenceDiagram`) and PlantUML (`@startuml`) sequence diagrams are read as well:
 *   title: 認証フロー
 *   participant API as API Server        (PlantUML: participant "API Server" as API)
 *   App -> API: リクエスト
 *   API --> App: レスポンス               (dashed = return; PlantUML's <- reverses)
 *   note over App, API: メモ              (PlantUML: a note over several lines, up to "end note")
 *   loop 3回 … end / alt … else … end    (drawn as dividers; also == 区切り == and ... 待ち ...)
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
  const rows = seqRows(d);
  const col = w > 0 ? Math.max(SEQ.minCol * k, (w - SEQ.padX * 2 * k) / n) : SEQ.col * k;
  const step = h > 0 ? Math.max(SEQ.minStep * k, (h - head) / (rows.total + 1)) : SEQ.step * k;
  return { col, step, w: SEQ.padX * 2 * k + n * col, h: head + (rows.total + 1) * step };
}

/** How many rows a note of several lines takes (one for a line or two), so it never covers its neighbours. */
const weight = (it: SeqItem): number => (it.kind === 'note' ? Math.max(1, (it.text.split('\n').length * SEQ_TEXT * 1.4 + 14) / SEQ.step) : 1);

/**
 * Where each item sits, in rows from the top of the lifelines: its centre (1 = the first row), and
 * how many rows the whole diagram takes.
 */
export function seqRows(d: SeqDiagram): { at: number[]; total: number } {
  const at: number[] = [];
  let used = 0;
  for (const it of d.items) {
    const w = weight(it);
    at.push(used + w / 2 + 0.5);
    used += w;
  }
  return { at, total: used };
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

/** The band each item takes across the diagram, in board coordinates: its centre line and height. */
export function seqBands(n: { x: number; y: number; w: number; h: number; text: string; fontSize?: number }): { y: number; h: number }[] {
  const d = parseSequence(n.text);
  const k = seqScale(n.fontSize);
  const { step } = seqLayout(n.text, n.w, n.h, k);
  const lifeTop = n.y + (SEQ.padTop + (d.title ? SEQ.titleH : 0) + SEQ.boxH) * k;
  const rows = seqRows(d);
  return d.items.map((it, i) => ({ y: lifeTop + rows.at[i] * step, h: weight(it) * step }));
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
/** A message: who, the arrow (keito and Mermaid "->>", "-x", "-)"; PlantUML "<-", "->x"), who, and its text. */
const MESSAGE = /^(.+?)\s*(<->|<-->|-->>|->>|-->x|->x|-->|->|--x|-x|--\)|-\)|<--|<-)\s*[+-]?\s*([^:：]+?)\s*(?:\+\+|--)?\s*(?:[:：]\s*(.*))?$/;
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
        if (close > at) {
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
    } else if ((m = MESSAGE.exec(plainLine)) && !/^(?:note|participant|actor)\s/i.test(line)) {
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
      // PlantUML's return answers the last message.
      const num = numbered ? ++count : undefined;
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
