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
  const col = w > 0 ? Math.max(SEQ.minCol * k, (w - SEQ.padX * 2 * k) / n) : SEQ.col * k;
  const step = h > 0 ? Math.max(SEQ.minStep * k, (h - head) / (d.items.length + 1)) : SEQ.step * k;
  return { col, step, w: SEQ.padX * 2 * k + n * col, h: head + (d.items.length + 1) * step };
}

/** The message text is 11px by default; a bigger text size scales the whole diagram with it. */
export const SEQ_TEXT = 11;
export const seqScale = (fontSize?: number): number => (fontSize ?? SEQ_TEXT) / SEQ_TEXT;

const cache = new Map<string, SeqDiagram>();

/** Lines that set up a diagram's look or behaviour in Mermaid or PlantUML (or fence it in Markdown), with nothing to draw here. */
const IGNORED = /^(?:```|sequenceDiagram|@startuml|@enduml|skinparam|hide|show|!|\|\|\||activate|deactivate|destroy|create|box\b|end box|autoactivate|newpage|scale|left to right|top to bottom|footer|header|legend|end legend)/i;
const BLOCK = /^(loop|alt|else|opt|par|and|critical|option|break|rect|group)\b\s*(.*)$/i;
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
  const lines = src.split('\n');
  for (let at = 0; at < lines.length; at++) {
    // Accept what a Japanese IME tends to produce: ： → ⇢ and full-width spaces.
    const line = lines[at].replace(/\u3000/g, ' ').replace(/⇢/g, '-->').replace(/→/g, '->').trim();
    if (!line || line.startsWith('#') || line.startsWith('%%') || line.startsWith("'") || IGNORED.test(line)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^title\s*[:：]?\s*(.*)$/i.exec(line))) {
      title = m[1];
    } else if (/^autonumber\b/i.test(line)) {
      numbered = true;
    } else if ((m = /^(?:participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i.exec(line))) {
      // Mermaid names the id first ("API as API Server"); PlantUML may quote the label first ("\"API Server\" as API").
      const rest = m[1].replace(/\s+(?:order\s+\d+|#\S+)\s*$/i, '');
      const q = /^"([^"]+)"\s*(?:as\s+(\S+))?$/.exec(rest);
      const plain = /^(\S+?)(?:\s+as\s+(.+))?$/.exec(rest);
      if (q) participants[index(q[2] ?? q[1])].label = q[1];
      else if (plain) {
        const i = index(plain[1]);
        if (plain[2]) participants[i].label = unquote(plain[2]);
      }
    } else if ((m = /^note\s+(?:over|left of|right of)\s+([^:：]+?)\s*(?:[:：]\s*(.*))?$/i.exec(line))) {
      // A PlantUML note may run over several lines, up to "end note".
      let text = m[2] ?? '';
      if (m[2] === undefined) {
        const body: string[] = [];
        while (++at < lines.length && !/^\s*end\s*note\b/i.test(lines[at])) body.push(lines[at].trim());
        text = body.join('\n');
      }
      const [a, b] = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      const over = index(a);
      items.push({ kind: 'note', over, ...(b ? { to: index(b) } : {}), text });
    } else if ((m = /^==\s*(.*?)\s*==$/.exec(line)) || (m = /^\.\.\.\s*(.*?)\s*(?:\.\.\.)?$/.exec(line))) {
      items.push({ kind: 'section', text: m[1] || '…' });
    } else if ((m = BLOCK.exec(line))) {
      // A block's start (and a branch of it) is a divider with its keyword and label; colours of "rect" are no label.
      const label = m[1].toLowerCase() === 'rect' ? '' : m[2].trim();
      items.push({ kind: 'section', text: [m[1].toLowerCase(), label].filter(Boolean).join(' ') });
    } else if (/^end\b/i.test(line)) {
      items.push({ kind: 'section', text: '', end: true });
    } else if ((m = /^return\b\s*(.*)$/i.exec(line))) {
      // PlantUML's return answers the last message.
      if (last) items.push({ kind: 'msg', from: last.to, to: last.from, text: (numbered ? `${++count}. ` : '') + m[1], dashed: true });
    } else if ((m = /^(.+?)\s*(<->|<-->|-->>|->>|-->|->|--x|-x|--\)|-\)|<--|<-)\s*[+-]?\s*([^:：]+?)\s*(?:\+\+|--)?\s*(?:[:：]\s*(.*))?$/.exec(line.replace(/-\[[^\]]*\]/g, '-')))) {
      // "<-" (PlantUML) points the other way; "x" ends lost; activation marks are dropped.
      const back = m[2].startsWith('<') && !m[2].endsWith('>');
      const from = index(back ? m[3] : m[1]);
      const to = index(back ? m[1] : m[3]);
      const text = (numbered ? `${++count}. ` : '') + (m[4] ?? '');
      items.push({ kind: 'msg', from, to, text, dashed: m[2].includes('--'), ...(m[2].endsWith('x') ? { cross: true } : {}) });
      last = { from, to };
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
