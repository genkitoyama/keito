import { upgradeHistory } from './history';
import { KINDS } from './kinds';
import { upgradeOrder } from './lists';
import type { Doc } from './types';
import { upgradeDoc } from './video';

/**
 * A board as read from storage, made current: null when it is not a board at all; empty text
 * boxes (invisible, left behind by older versions) dropped; old forms brought up to date.
 * Shared by the app and the command line, so both read a board the same way.
 */
export function readBoard(v: unknown): Doc | null {
  const d = v as Doc | null;
  if (!d || d.version !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) return null;
  d.nodes = d.nodes.filter((n) => n.type !== 'text' || (n.text ?? '').trim() !== '');
  d.revisions = upgradeHistory(d.revisions);
  // A kind this version does not know (a board from a newer keito, a hand edit) is read as a system board.
  if (d.kind !== undefined && !(d.kind in KINDS)) d.kind = undefined;
  return upgradeOrder(upgradeDoc(d));
}
