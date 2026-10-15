/**
 * Sequence diagram source (Mermaid-like subset):
 *   title: 認証フロー
 *   participant API as API Server
 *   App -> API: リクエスト
 *   API --> App: レスポンス        (dashed = return)
 *   note over App: メモ
 */
export interface SeqParticipant {
  id: string;
  label: string;
}
export type SeqItem =
  | { kind: 'msg'; from: number; to: number; text: string; dashed: boolean }
  | { kind: 'note'; over: number; text: string };

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

export function parseSequence(src: string): SeqDiagram {
  const hit = cache.get(src);
  if (hit) return hit;
  let title = '';
  const participants: SeqParticipant[] = [];
  const items: SeqItem[] = [];
  const index = (id: string): number => {
    const key = id.trim();
    let i = participants.findIndex((p) => p.id === key);
    if (i < 0) {
      participants.push({ id: key, label: key });
      i = participants.length - 1;
    }
    return i;
  };
  for (const raw of src.split('\n')) {
    // Accept what a Japanese IME tends to produce: ： → ⇢ and full-width spaces.
    const line = raw.replace(/\u3000/g, ' ').replace(/⇢/g, '-->').replace(/→/g, '->').trim();
    if (!line || line.startsWith('#') || line.startsWith('%%')) continue;
    let m: RegExpExecArray | null;
    if ((m = /^title\s*[:：]\s*(.*)$/i.exec(line))) {
      title = m[1];
    } else if ((m = /^(?:participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line))) {
      const i = index(m[1]);
      if (m[2]) participants[i].label = m[2].trim();
    } else if ((m = /^note\s+(?:over|left of|right of)\s+([^:：]+)[:：]\s*(.*)$/i.exec(line))) {
      items.push({ kind: 'note', over: index(m[1].split(',')[0]), text: m[2] });
    } else if ((m = /^(.+?)\s*(-->>|->>|-->|->)\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/.exec(line))) {
      items.push({ kind: 'msg', from: index(m[1]), to: index(m[3]), text: m[4] ?? '', dashed: m[2].startsWith('--') });
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
