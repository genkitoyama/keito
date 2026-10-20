import type { DeviceNode, Doc, Node } from './types';

/**
 * Things shared between the boards of a project. The PC on one system board, the same PC on another
 * (the backyard's, the venue's) and the PC a piece of software runs on are one thing: devices
 * carrying the same `shared` key. Their particulars (name, maker, model …) are kept alike — the newest wins, by
 * `sharedAt` — when one is edited (written through to the other boards) and when a board is
 * opened (taking in what changed elsewhere meanwhile, say by the command line).
 *
 * A piece of software names the device it runs on (`runsOn`) and takes its host name and address.
 */

export type ShareNode = DeviceNode;
/** Only devices are shared (gear and software alike). */
export const canShare = (n: Node): n is ShareNode => n.type === 'device';

/** Particulars kept alike between devices. */
const DEVICE_FIELDS = ['text', 'maker', 'model', 'category', 'ip', 'host', 'url'] as const;

/** The particulars of a node that sharing keeps alike, as a comparable string. */
export function signature(n: ShareNode): string {
  return JSON.stringify(DEVICE_FIELDS.map((k) => n[k] ?? ''));
}

/** `target` with the particulars of `source`. */
export function takeFrom(target: ShareNode, source: ShareNode): ShareNode {
  const next = { ...target };
  for (const k of DEVICE_FIELDS) (next as unknown as Record<string, unknown>)[k] = k === 'text' || k === 'maker' || k === 'model' || k === 'category' ? (source[k] ?? '') : source[k];
  return { ...next, sharedAt: source.sharedAt };
}

/** One shareable node of a board of the project, as the catalog lists it. */
export interface Entry {
  board: string;
  boardTitle: string;
  kind: Doc['kind'];
  node: ShareNode;
}

/** Every shareable node with a name on the given boards (the project's), the open board included. */
export function catalog(boards: Doc[]): Entry[] {
  return boards.flatMap((d) => d.nodes.filter(canShare).filter((n) => n.text.trim()).map((node) => ({ board: d.id, boardTitle: d.meta.title, kind: d.kind, node })));
}

/**
 * Which copy speaks for a shared thing when none says when it was changed (keys written by hand
 * in YAML): the copy on a system board.
 */
const weight = (kind: Doc['kind']): number => ((kind ?? 'system') === 'system' ? 1 : 0);

/** Whether copy `a` wins over copy `b`: the newer one, or with no time on either, the weightier. */
function wins(a: ShareNode, aKind: Doc['kind'], b: ShareNode, bKind: Doc['kind']): boolean {
  const ta = a.sharedAt ?? 0;
  const tb = b.sharedAt ?? 0;
  if (ta || tb) return ta > tb;
  return weight(aKind) > weight(bKind);
}

/** The version of a shared thing that wins across the project (see `wins`). */
export function newest(entries: Entry[], key: string): Entry | undefined {
  let best: Entry | undefined;
  for (const e of entries) if (e.node.shared === key && (!best || wins(e.node, e.kind, best.node, best.kind))) best = e;
  return best;
}

/** The device behind a key (what software runs on), the newest copy. */
export function deviceOf(entries: Entry[], key: string): DeviceNode | undefined {
  const own = entries.filter((e) => e.node.shared === key);
  return own.sort((a, b) => (b.node.sharedAt ?? 0) - (a.node.sharedAt ?? 0))[0]?.node;
}

/** A device's name as the host of software ("メインPC"), first line only. */
export const deviceName = (d: DeviceNode): string => d.text.split('\n')[0].trim();

/**
 * The open board brought up to date with the rest of the project: shared nodes take newer
 * particulars from elsewhere, software takes the host of the device it runs on. Returns the same doc
 * when nothing changed.
 */
export function pull(doc: Doc, entries: Entry[]): Doc {
  const others = entries.filter((e) => e.board !== doc.id);
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    let next: Node = n;
    if (canShare(n) && n.shared) {
      const best = newest(others, n.shared);
      if (best && wins(best.node, best.kind, n, doc.kind)) {
        const taken = takeFrom(n, best.node);
        if (signature(taken) !== signature(n) || taken.sharedAt !== n.sharedAt) next = taken;
      }
    }
    if (next.type === 'device' && next.runsOn) {
      const host = deviceOf(entries, next.runsOn);
      const want = host ? { host: host.host?.trim() || deviceName(host), ip: host.ip } : null;
      if (want && (want.host !== next.host || want.ip !== next.ip)) next = { ...next, ...want };
    }
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...doc, nodes } : doc;
}

/** A new shared key. */
export const newKey = (): string => `sh_${Math.random().toString(36).slice(2, 10)}`;

/** Where else a shared thing appears: every other node with its key, on any board of the project. */
export const occurrences = (entries: Entry[], key: string | undefined, self: { board: string; node: string }): Entry[] =>
  key ? entries.filter((e) => e.node.shared === key && !(e.board === self.board && e.node.id === self.node)) : [];

/**
 * `doc` with the shared nodes whose particulars were edited since `prev` marked as changed `now`,
 * so they win over the other boards' copies; the same doc when none was.
 */
export function stamp(prev: Doc, doc: Doc, now: number): Doc {
  const before = new Map(prev.nodes.filter(canShare).map((n) => [n.id, n]));
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    if (!canShare(n) || !n.shared) return n;
    const was = before.get(n.id);
    if (!was || was.shared !== n.shared || signature(was) === signature(n)) return n;
    changed = true;
    return { ...n, sharedAt: now };
  });
  return changed ? { ...doc, nodes } : doc;
}
