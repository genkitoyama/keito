import { upgradeHistory } from './history';
import { KINDS } from './kinds';
import { upgradeOrder } from './lists';
import type { Doc } from './types';
import { upgradeDoc } from './video';

/**
 * A board's kind as stored, made current: the layout, screen layout and experience flow boards of
 * old are free boards now; a kind this version does not know (a board from a newer keito, a hand
 * edit) is a system board.
 */
export function boardKind(kind: unknown): Doc['kind'] {
  if (kind === 'layout' || kind === 'screen' || kind === 'flow') return 'free';
  return typeof kind === 'string' && kind in KINDS && kind !== 'system' ? (kind as Doc['kind']) : undefined;
}

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
  d.kind = boardKind(d.kind);
  const old = d as Doc & { scale?: unknown; pxScale?: unknown };
  delete old.scale;
  delete old.pxScale;
  // So are the particulars only those boards used: real sizes, racks, screen regions, flow roles; and shared shapes.
  d.nodes = d.nodes.map((n) => {
    if (n.type !== 'shape') return n;
    const { dims, rack, screen, flow, shared, sharedAt, ...rest } = n as typeof n & Record<'dims' | 'rack' | 'screen' | 'flow' | 'shared' | 'sharedAt', unknown>;
    return dims === undefined && rack === undefined && screen === undefined && flow === undefined && shared === undefined && sharedAt === undefined ? n : rest;
  });
  return upgradeOrder(upgradeDoc(d));
}
