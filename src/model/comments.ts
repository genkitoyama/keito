import { center, intersects, nodeRect } from './geometry';
import { type SeqDiagram, parseSequence, seqBands, seqDescribe, seqFollow, seqSig } from './sequence';
import type { CommentPin, Doc, SequenceNode, StickyNode } from './types';

/**
 * Comments are the stickies of a board: questions and to-dos about the drawing rather than part
 * of it. They are listed (open ones first) and settled one by one, and exports leave them out
 * unless asked to keep them.
 */
export const commentsOf = (doc: Doc): StickyNode[] => doc.nodes.filter((n): n is StickyNode => n.type === 'sticky');

export const openComments = (doc: Doc): StickyNode[] => commentsOf(doc).filter((n) => !n.done);

/** The board without its comments, nor the arrows drawn to or from them: what an export shows. */
export function withoutComments(doc: Doc): Doc {
  const gone = new Set(commentsOf(doc).map((n) => n.id));
  if (!gone.size) return doc;
  return { ...doc, nodes: doc.nodes.filter((n) => !gone.has(n.id)), edges: doc.edges.filter((e) => !gone.has(e.from.node) && !gone.has(e.to.node)) };
}

/** How far beside a diagram a sticky still counts as being on it. */
const PIN_REACH = 60;

/** The sequence diagram a sticky would be pinned to where it sits, and which of its items: the topmost diagram it overlaps or sits right beside, the row nearest its centre. */
function pinAt(doc: Doc, s: StickyNode): { seq: SequenceNode; item: number; band: { y: number; h: number } } | null {
  const r = nodeRect(s);
  const c = center(r);
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    // Beside the diagram counts as on it: a comment is as often put next to a row as over it.
    const b = nodeRect(n);
    if (n.type !== 'sequence' || !intersects(r, { x: b.x - PIN_REACH, y: b.y, w: b.w + PIN_REACH * 2, h: b.h })) continue;
    const bands = seqBands(n);
    let best = -1;
    let gap = Infinity;
    bands.forEach((b, j) => {
      const g = Math.max(0, Math.abs(c.y - b.y) - b.h / 2);
      if (g < gap) [best, gap] = [j, g];
    });
    // Over the participants' heads or well below the last row: about the diagram, not one of its items.
    if (best < 0 || gap > bands[best].h) return null;
    return { seq: n, item: best, band: bands[best] };
  }
  return null;
}

const sigOf = (seq: SequenceNode, i: number): string => {
  const d = parseSequence(seq.text);
  return seqSig(d, d.items[i]);
};

function bySig(d: SeqDiagram, on: CommentPin): number {
  const same = d.items.map((it, i) => (seqSig(d, it) === on.sig ? i : -1)).filter((i) => i >= 0);
  return same.length ? same.reduce((a, b) => (Math.abs(b - on.item) < Math.abs(a - on.item) ? b : a)) : -1;
}

/** The item a pinned comment is about, while it is still there. */
export function pinTarget(doc: Doc, s: StickyNode): { seq: SequenceNode; item: number; band: { y: number; h: number }; label: string } | null {
  if (!s.on || s.on.lost) return null;
  const seq = doc.nodes.find((n): n is SequenceNode => n.id === s.on!.seq && n.type === 'sequence');
  const band = seq && seqBands(seq)[s.on.item];
  if (!seq || !band) return null;
  return { seq, item: s.on.item, band, label: seqDescribe(parseSequence(seq.text), s.on.item) };
}

/**
 * Keep comments on the sequence items they are about. A sticky put down or moved is pinned to the
 * item under it (or to nothing, off the diagrams); a pinned one that stays put follows its item
 * when the diagram's source is rewritten, or the diagram moves or resizes. When the item is gone
 * the comment stays where it is, marked lost.
 */
export function pinComments(prev: Doc, next: Doc): Doc {
  if (prev.id !== next.id || prev.nodes === next.nodes) return next;
  if (!next.nodes.some((n) => n.type === 'sticky')) return next;
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  let changed = false;
  const nodes = next.nodes.map((n) => {
    if (n.type !== 'sticky') return n;
    const was = before.get(n.id);
    // Only a move re-pins: a sticky growing with its text stays on what it was about.
    const moved = !was || was.type !== 'sticky' || was.x !== n.x || was.y !== n.y;
    if (moved) {
      const hit = pinAt(next, n);
      const on: CommentPin | undefined = hit
        ? { seq: hit.seq.id, item: hit.item, sig: sigOf(hit.seq, hit.item), dx: n.x - hit.seq.x, dy: n.y - hit.band.y }
        : undefined;
      if (JSON.stringify(on) === JSON.stringify(n.on)) return n;
      changed = true;
      return { ...n, on };
    }
    if (!n.on || n.on.lost) return n;
    const seq = next.nodes.find((m): m is SequenceNode => m.id === n.on!.seq && m.type === 'sequence');
    const old = before.get(n.on.seq);
    if (seq && old === seq) return n;
    changed = true;
    if (!seq) return { ...n, on: { ...n.on, lost: true } };
    const d = parseSequence(seq.text);
    // Matched across the edit; failing that (a line moved elsewhere in the source, the diagram back
    // after it was gone) found again by what it said.
    const followed = old?.type === 'sequence' ? seqFollow(old.text, seq.text, n.on.item) : -1;
    const item = followed >= 0 ? followed : bySig(d, n.on);
    const band = seqBands(seq)[item];
    if (item < 0 || !band) return { ...n, on: { ...n.on, lost: true } };
    return { ...n, x: seq.x + n.on.dx, y: band.y + n.on.dy, on: { ...n.on, item, sig: seqSig(d, d.items[item]) } };
  });
  return changed ? { ...next, nodes } : next;
}

/** What a comment is about, in words: "起動シーケンス › 制御PC → SV: 再生開始", or that the item is gone. */
export function pinLabel(doc: Doc, s: StickyNode): { text: string; lost: boolean } | null {
  if (!s.on) return null;
  if (s.on.lost) return { text: '対象の処理が消えました', lost: true };
  const t = pinTarget(doc, s);
  if (!t) return null;
  return { text: `${parseSequence(t.seq.text).title || 'シーケンス図'} › ${t.label}`, lost: false };
}
