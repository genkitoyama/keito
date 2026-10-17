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
  | { kind: 'msg'; from: number; to: number; text: string; dashed: boolean; cross?: boolean }
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
      const text = (numbered ? `${++count}. ` : '') + (m[4] ?? '');
      items.push({ kind: 'msg', from, to, text, dashed: m[2].includes('--'), ...(m[2].endsWith('x') ? { cross: true } : {}) });
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
      if (last) items.push({ kind: 'msg', from: last.to, to: last.from, text: (numbered ? `${++count}. ` : '') + (m[1] ?? ''), dashed: true });
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
