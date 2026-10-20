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
  // Layout, screen layout and experience flow boards are no more: their drawings stay, as free boards.
  const old = d as Omit<Doc, 'kind'> & { kind?: string; scale?: unknown; pxScale?: unknown };
  if (old.kind === 'layout' || old.kind === 'screen' || old.kind === 'flow') d.kind = 'free';
  delete old.scale;
  delete old.pxScale;
  // So are the particulars only those boards used: real sizes, racks, screen regions, flow roles; and shared shapes.
  d.nodes = d.nodes.map((n) => {
    if (n.type !== 'shape') return n;
    const { dims, rack, screen, flow, shared, sharedAt, ...rest } = n as typeof n & Record<'dims' | 'rack' | 'screen' | 'flow' | 'shared' | 'sharedAt', unknown>;
    return dims === undefined && rack === undefined && screen === undefined && flow === undefined && shared === undefined && sharedAt === undefined ? n : rest;
  });
  // A kind this version does not know (a board from a newer keito, a hand edit) is read as a system board.
  if (d.kind !== undefined && !(d.kind in KINDS)) d.kind = undefined;
  return upgradeOrder(upgradeDoc(d));
}
