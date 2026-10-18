import type { Doc, Node, RackSpec, ShapeNode } from './types';

/**
 * Racks on a layout board: a rack is a piece of furniture that lists what is mounted in it, top
 * first, each with the units it takes — enough to plan the gear of a rack without drawing it.
 */

export type RackNode = ShapeNode & { rack: RackSpec };
export const isRack = (n: Node): n is RackNode => n.type === 'shape' && !!n.rack;

/** Units taken by what is listed, and how many are left (negative: it does not fit). */
export function rackUse(rack: RackSpec): { used: number; free: number } {
  const used = rack.items.reduce((sum, i) => sum + Math.max(0, i.u), 0);
  return { used, free: rack.units - used };
}

/** A rack's contents as lines (for the drawing beside it): "L2スイッチ 1U", then what is free. */
export function rackLines(rack: RackSpec): string[] {
  const { free } = rackUse(rack);
  return [...rack.items.map((i) => `${i.name.trim() || '（名前なし）'} ${i.u}U`), free >= 0 ? `空き ${free}U` : `${-free}U 足りません`];
}

/** Every rack of the board, in the order they were placed. */
export const racksOf = (doc: Doc): RackNode[] => doc.nodes.filter(isRack);
