import type { Edge, EdgeEnd, Node } from './types';

/**
 * What kind of video or audio cable a line is, for its cable ID: HDMI-01, SDI-01, XLR-01 rather
 * than one number run for all video or all audio. Read from the cable's spec, else from the names
 * of the ports at its ends ("HDMI OUT", "IN RCA").
 */
type Rule = [RegExp, string];

// Latin names must stand apart ("TS" is not the end of "PORTS"); Japanese ones need not.
const word = (s: string): RegExp => new RegExp(`(?<![a-z0-9])(?:${s})(?![a-z0-9])`, 'i');

const RULES: Record<string, Rule[]> = {
  video: [
    [word('(?:\\d+g-?)?sdi'), 'SDI'],
    [word('hdmi'), 'HDMI'],
    [word('displayport|dp'), 'DP'],
    [word('dvi'), 'DVI'],
    [word('vga'), 'VGA'],
  ],
  audio: [
    [/マイク|(?<![a-z0-9])mic(?![a-z0-9])/i, 'MIC'],
    [/スピーカー|(?<![a-z0-9])(?:spk|speakon)(?![a-z0-9])/i, 'SPK'],
    [/キャノン|(?<![a-z0-9])xlr(?![a-z0-9])/i, 'XLR'],
    [word('trs'), 'TRS'],
    [word('ts'), 'TS'],
    [word('rca'), 'RCA'],
    [/ユーロブロック|(?<![a-z0-9])(?:phoenix|euroblock)(?![a-z0-9])/i, 'PHX'],
    [word('d-?sub'), 'DSUB'],
    [word('aes(?:/?ebu)?'), 'AES'],
    [/光デジタル|(?<![a-z0-9])(?:toslink|optical)(?![a-z0-9])/i, 'OPT'],
    [/ミニプラグ|(?<![a-z0-9.])3\.5\s*mm/i, 'MINI'],
  ],
};

/** The kind named first in a piece of text ("XLR→Phoenix" is an XLR cable). */
function earliest(rules: Rule[], text: string | undefined): string | null {
  if (!text) return null;
  let best: { at: number; kind: string } | null = null;
  for (const [re, kind] of rules) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, kind };
  }
  return best?.kind ?? null;
}

/**
 * An audio spec that opens with a connector this list does not know ("EN3") still heads its own
 * run. Only a name in capitals counts, so a brand ("Belden 8451") is not taken for one.
 */
const firstWord = (text: string | undefined): string | null => {
  const m = text ? /^[\s(（]*([A-Z][A-Z0-9-]{1,7})(?![A-Za-z0-9])/.exec(text) : null;
  return m ? m[1].replace(/-/g, '').toUpperCase() : null;
};

const portName = (nodes: Node[], end: EdgeEnd): string | undefined => {
  const n = nodes.find((x) => x.id === end.node);
  return n?.type === 'device' ? n.ports.find((p) => p.id === end.port)?.name : undefined;
};

/** The kind of a video or audio cable: its spec says, else the ports at its ends do; null for anything else. */
export function cableKind(nodes: Node[], e: Edge): string | null {
  const rules = RULES[e.signal];
  if (!rules) return null;
  return (
    earliest(rules, e.spec) ??
    (e.signal === 'audio' ? firstWord(e.spec) : null) ??
    earliest(rules, portName(nodes, e.from)) ??
    earliest(rules, portName(nodes, e.to))
  );
}
