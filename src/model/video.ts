import { VIDEO_STANDARDS } from './signals';
import { cableKind } from './standards';
import type { Doc, Edge, Node, Port, UserPreset } from './types';

const legacy = (id: string): boolean => Object.prototype.hasOwnProperty.call(VIDEO_STANDARDS, id);

const upgradePorts = (ports: Port[]): Port[] => (ports.some((p) => legacy(p.signal)) ? ports.map((p) => (legacy(p.signal) ? { ...p, signal: 'video' } : p)) : ports);

/**
 * A video cable typed by its old type (hdmi, sdi, dp), as 映像. The standard the old type stood
 * for goes into the spec only when nothing else tells it, so the line's label does not gain a
 * word that its ports already say.
 */
export function upgradeEdge(nodes: Node[], e: Edge): Edge {
  if (!legacy(e.signal)) return e;
  const told = !!e.spec?.trim() || !!cableKind(nodes, { ...e, signal: 'video' });
  return { ...e, signal: 'video', spec: told ? e.spec : VIDEO_STANDARDS[e.signal] };
}

/** A board saved before HDMI, SDI and DisplayPort became 映像, brought up to date. */
export function upgradeDoc(doc: Doc): Doc {
  const colours = Object.keys(doc.signalColors ?? {});
  const stale =
    doc.edges.some((e) => legacy(e.signal)) ||
    doc.nodes.some((n) => n.type === 'device' && n.ports.some((p) => legacy(p.signal))) ||
    colours.some(legacy) ||
    !!doc.signals?.some((s) => legacy(s.id));
  if (!stale) return doc;
  let signalColors = doc.signalColors;
  if (signalColors && colours.some(legacy)) {
    const kept = Object.fromEntries(Object.entries(signalColors).filter(([k]) => !legacy(k)));
    // A colour the board gave HDMI (the usual one) carries over to 映像.
    const carried = signalColors.video ?? signalColors.hdmi ?? signalColors.sdi ?? signalColors.dp;
    signalColors = { ...kept, ...(carried ? { video: carried } : {}) };
  }
  const signals = doc.signals?.filter((s) => !legacy(s.id));
  return {
    ...doc,
    // Edges first: the standard is read from the ports' names, which do not change.
    edges: doc.edges.map((e) => upgradeEdge(doc.nodes, e)),
    nodes: doc.nodes.map((n) => (n.type === 'device' && n.ports.some((p) => legacy(p.signal)) ? { ...n, ports: upgradePorts(n.ports) } : n)),
    signalColors: signalColors && Object.keys(signalColors).length ? signalColors : undefined,
    signals: signals?.length ? signals : undefined,
  };
}

export const upgradePreset = (p: UserPreset): UserPreset => (p.ports?.some((q) => legacy(q.signal)) ? { ...p, ports: upgradePorts(p.ports) } : p);
