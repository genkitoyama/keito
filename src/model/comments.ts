import type { Doc, StickyNode } from './types';

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
