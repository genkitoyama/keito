import { isTagged, isUnderlay, nodeRect, routeEdges } from './geometry';
import { cableIds } from './lists';
import { signalOf } from './signals';
import type { Doc, Rect } from './types';

/** One thing on the board that matches: what it is, what it is called, and where the words were found. */
export interface Hit {
  id: string;
  kind: '機材' | 'ケーブル' | '線' | 'エリア' | '付箋' | 'テキスト' | '図形' | '画像';
  name: string;
  /** The field the words were found in, and its value as written. */
  field: string;
  value: string;
}

/**
 * Text as compared: full-width folded to half, case dropped, and the spaces and joining marks
 * ("-", "・" …) left out, so "lan03" finds LAN-03 and "ｐｊ" finds PJ.
 */
export const fold = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_./・:：‐−–—]/g, '');

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim();

/**
 * Everything on the board whose words hold the query, the best first: matches at the start of a
 * name before ones in the middle, devices before cables before the rest, then as on the board.
 */
export function searchDoc(doc: Doc, query: string): Hit[] {
  const q = fold(query);
  if (!q) return [];
  const ids = cableIds(doc);
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const scored: { hit: Hit; score: number }[] = [];
  const tryFields = (base: Omit<Hit, 'field' | 'value'>, fields: [string, string | undefined][], rank: number) => {
    for (const [i, [field, value]] of fields.entries()) {
      if (!value?.trim()) continue;
      const at = fold(value).indexOf(q);
      if (at < 0) continue;
      scored.push({ hit: { ...base, field, value: oneLine(value) }, score: rank * 100 + i * 10 + (at === 0 ? 0 : 5) });
      return;
    }
  };
  for (const n of doc.nodes) {
    if (n.type === 'junction' || n.type === 'legend' || isUnderlay(n)) continue;
    const name = oneLine(n.text) || n.id;
    if (n.type === 'device') tryFields({ id: n.id, kind: '機材', name }, [['名前', n.text], ['型番', n.model], ['メーカー', n.maker], ['IP', n.ip], ['ホスト名', n.host], ['カテゴリ', n.category], ['手配先', n.vendor], ['備考', n.note]], 0);
    else if (n.type === 'frame') tryFields({ id: n.id, kind: 'エリア', name }, [['名前', n.text]], 2);
    else if (n.type === 'sticky') tryFields({ id: n.id, kind: '付箋', name }, [['文', n.text]], 3);
    else if (n.type === 'text') tryFields({ id: n.id, kind: 'テキスト', name }, [['文', n.text]], 3);
    else if (n.type === 'shape') tryFields({ id: n.id, kind: '図形', name }, [['文', n.text]], 3);
    else if (n.type === 'image') tryFields({ id: n.id, kind: '画像', name }, [['名前', n.text], ['キャプション', n.caption]], 3);
  }
  for (const e of doc.edges) {
    const cable = signalOf(e.signal).cable;
    const from = oneLine(nodes.get(e.from.node)?.text ?? '');
    const to = oneLine(nodes.get(e.to.node)?.text ?? '');
    const id = cable ? ids.get(e.id) : undefined;
    const name = [id, `${from} → ${to}`].filter(Boolean).join('  ');
    tryFields({ id: e.id, kind: cable ? 'ケーブル' : '線', name }, [['ケーブル ID', id], ['品名・規格', e.spec], ['ラベル', e.label], ['型番', e.model], ['備考', e.note]], 1);
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.hit);
}

/** Where a hit is on the board, to bring it into view: a node's box, a line's run or its tags. */
export function hitRect(doc: Doc, id: string): Rect | null {
  const n = doc.nodes.find((x) => x.id === id);
  if (n) return nodeRect(n);
  const e = doc.edges.find((x) => x.id === id);
  if (!e) return null;
  const pts = isTagged(doc, e) ? [] : (routeEdges(doc).get(e.id) ?? []);
  // A line drawn as tags is where its ends are.
  const ends = pts.length ? pts : [e.from.node, e.to.node].flatMap((nid) => {
    const m = doc.nodes.find((x) => x.id === nid);
    return m ? [{ x: m.x, y: m.y }, { x: m.x + nodeRect(m).w, y: m.y + nodeRect(m).h }] : [];
  });
  if (!ends.length) return null;
  const xs = ends.map((p) => p.x);
  const ys = ends.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
