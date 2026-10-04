import { center, nodeRect, portPos } from './geometry';
import type { Doc, EdgeEnd, Node } from './types';

/**
 * Make a line run dead straight: drop its hand-placed bends and, when its two
 * ends are not level, shift one of the nodes until they are. The node that
 * moves is the one with fewer connections (the display follows the PC, not the
 * other way round). Returns null when the ends cannot face each other — two
 * ports on the same side, say — or when levelling them would mean moving a
 * node further than `reach`: that is rearranging the diagram, not tidying a line.
 */
export function straighten(doc: Doc, id: string, reach = 60): Doc | null {
  const e = doc.edges.find((x) => x.id === id);
  const a = e && doc.nodes.find((n) => n.id === e.from.node);
  const b = e && doc.nodes.find((n) => n.id === e.to.node);
  if (!e || !a || !b || a.id === b.id) return null;

  const attach = (n: Node, end: EdgeEnd) => {
    const p = n.type === 'device' && end.port ? portPos(n, end.port) : null;
    return p ? { x: p.x, y: p.y, side: p.side } : { ...center(nodeRect(n)), side: null };
  };
  const pa = attach(a, e.from);
  const pb = attach(b, e.to);
  // How far the `to` node would have to move.
  let dx = 0;
  let dy = 0;
  if (pa.side || pb.side) {
    // Ports face left or right: straight means level, with the other end on the side the port faces.
    const toIsRight = pb.x > pa.x;
    if (pa.side && (pa.side === 'right') !== toIsRight) return null;
    if (pb.side && (pb.side === 'left') !== toIsRight) return null;
    dy = pa.y - pb.y;
  } else {
    const ra = nodeRect(a);
    const rb = nodeRect(b);
    if (Math.abs(pb.x - pa.x) / (ra.w + rb.w) >= Math.abs(pb.y - pa.y) / (ra.h + rb.h)) dy = pa.y - pb.y;
    else dx = pa.x - pb.x;
  }

  if (Math.abs(dx) + Math.abs(dy) > reach) return null;

  const degree = (n: Node): number => doc.edges.filter((x) => x.from.node === n.id || x.to.node === n.id).length;
  const moveTo = degree(b) <= degree(a);
  const mover = moveTo ? b : a;
  const shift = moveTo ? { x: dx, y: dy } : { x: -dx, y: -dy };
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === mover.id ? { ...n, x: n.x + shift.x, y: n.y + shift.y } : n)),
    edges: doc.edges.map((x) => (x.id === id ? { ...x, route: undefined } : x)),
  };
}
