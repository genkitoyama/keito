import { describe, expect, it } from 'vitest';
import { fromYaml, toYaml } from '../src/model/dsl';
import { docBounds, nodeAt } from '../src/model/geometry';
import type { DeviceNode } from '../src/model/types';
import { blank, sample } from './helpers';

describe('YAML', () => {
  it('keeps label sizes, quantities and prices through a round trip', () => {
    const d = sample();
    const dev = d.nodes.find((n): n is DeviceNode => n.type === 'device')!;
    const edge = d.edges.find((e) => e.signal === 'video')!;
    const edited = {
      ...d,
      labelSize: 9,
      nodes: d.nodes.map((n) => (n === dev ? { ...dev, qty: 3, price: 120000 } : n)),
      edges: d.edges.map((e) => (e === edge ? { ...e, fontSize: 12 } : e)),
    };
    const back = fromYaml(toYaml(edited), edited);
    expect(back.labelSize).toBe(9);
    expect(back.nodes.find((n) => n.id === dev.id)).toMatchObject({ qty: 3, price: 120000 });
    expect(back.edges.find((e) => e.id === edge.id)?.fontSize).toBe(12);
  });

  it('keeps a picture caption, its side and size, and counts it in the drawing', () => {
    const pic = { id: 'img1', type: 'image' as const, x: 0, y: 100, w: 200, h: 100, text: 'plan', src: 'asset:plan.png', caption: '会場平面図', captionAt: 'top' as const, fontSize: 18 };
    const doc = { version: 1 as const, id: 't', meta: { title: '', project: '' }, nodes: [pic], edges: [] };
    const back = fromYaml(toYaml(doc), doc);
    expect(back.nodes[0]).toMatchObject({ caption: '会場平面図', captionAt: 'top', fontSize: 18, src: 'asset:plan.png' });
    // Above the picture: the drawing reaches up to it, and a click on it picks the picture.
    const box = docBounds(back)!;
    expect(box.y).toBeLessThan(100 - 18);
    expect(box.y + box.h).toBe(200);
    expect(nodeAt(back, { x: 100, y: box.y + 4 })?.id).toBe('img1');
  });

  it('gives the same YAML back for the sample board', () => {
    const d = sample();
    expect(toYaml(fromYaml(toYaml(d), d))).toBe(toYaml(d));
  });
});

describe('YAML keeps what devices and lines are', () => {
  it('keeps a device the venue has, and a radio line made solid', () => {
    const doc = fromYaml(`title: t
devices:
  - { id: w, name: 会場電源, venue: true, out: [AC:power] }
  - { id: ap, name: AP, out: [Wi-Fi:wireless] }
  - { id: pad, name: iPad, in: [Wi-Fi:wireless] }
cables:
  - { from: ap.Wi-Fi, to: pad.Wi-Fi, type: wireless, dash: false }
`, blank());
    const back = fromYaml(toYaml(doc), doc);
    expect((back.nodes.find((n) => n.id === 'w') as DeviceNode).venue).toBe(true);
    expect(back.edges[0].dash).toBe(false);
  });
});

describe('YAML keeps what lines are', () => {
  const blank = () => ({ version: 1 as const, id: 't', meta: { title: '', project: '' }, nodes: [], edges: [] });

  it('keeps line ids, and a cable list put in order by hand with them', () => {
    const d = sample();
    // Lines removed from the middle leave gaps in the numbering; the order names the rest.
    const kept = d.edges.filter((_, i) => i % 2 === 1);
    const order = [...kept].reverse().filter((e) => e.signal !== 'flow').map((e) => e.id);
    const doc = { ...d, edges: kept, listOrder: { cables: order } };
    const back = fromYaml(toYaml(doc), doc);
    expect(back.edges.map((e) => e.id)).toEqual(kept.map((e) => e.id));
    expect(back.listOrder?.cables).toEqual(order);
  });

  it('gives a new line an id no listed line has', () => {
    const yaml = ['devices:', '  - { id: a, name: A }', '  - { id: b, name: B }', 'cables:', '  - { from: a, to: b, type: lan }', '  - { id: e1, from: b, to: a, type: lan }'].join('\n');
    const d = fromYaml(yaml, blank());
    expect(d.edges[1].id).toBe('e1');
    expect(d.edges[0].id).not.toBe('e1');
  });

  it('keeps a flow line’s text size and stacking', () => {
    const yaml = ['shapes:', '  - { id: s1, shape: rect, text: A }', '  - { id: s2, shape: rect, text: B }', 'flows:', '  - { from: s1, to: s2, label: x, fontSize: 16, stacked: true }'].join('\n');
    const d = fromYaml(yaml, blank());
    const back = fromYaml(toYaml(d), d);
    expect(back.edges[0]).toMatchObject({ fontSize: 16, stacked: true });
  });

  it('keeps a cable on a port without a name, and one held to a side of a device', () => {
    const d = fromYaml(['devices:', '  - { id: a, name: A, out: [":lan", ":lan"] }', '  - { id: b, name: B }', 'cables:', '  - { from: a, to: b, type: lan, toSide: top }'].join('\n'), blank());
    const a = d.nodes.find((n): n is DeviceNode => n.id === 'a')!;
    // On the second unnamed port.
    const doc = { ...d, edges: [{ ...d.edges[0], from: { node: 'a', port: a.ports[1].id } }] };
    const back = fromYaml(toYaml(doc), doc);
    expect(back.edges[0].from.port).toBe(a.ports[1].id);
    expect(back.edges[0].to).toEqual({ node: 'b', side: 'top' });
  });

  it('names a port it adds as the board does', () => {
    const d = fromYaml(['devices:', '  - { id: a, name: A }', '  - { id: b, name: B }', 'cables:', '  - { from: a, to: b, type: audio }'].join('\n'), blank());
    const a = d.nodes.find((n): n is DeviceNode => n.id === 'a')!;
    expect(a.ports.map((p) => p.name)).toEqual(['AUD 1']);
  });

  it('puts a cable with no type or start port on a free port of the signal it goes into', () => {
    const d = fromYaml(['devices:', '  - { id: hub, name: Hub, out: ["LAN 1:lan"] }', '  - { id: pc, name: PC, in: ["LAN:lan"] }', '  - { id: pc2, name: PC 2, in: ["LAN:lan"] }', 'cables:', '  - { from: hub, to: pc.LAN }', '  - { from: hub, to: pc2.LAN }'].join('\n'), blank());
    const hub = d.nodes.find((n): n is DeviceNode => n.id === 'hub')!;
    expect(hub.ports.map((p) => [p.name, p.side])).toEqual([['LAN 1', 'right'], ['LAN 2', 'right']]);
    expect(d.edges.map((e) => e.from.port)).toEqual(hub.ports.map((p) => p.id));
  });
});

describe('YAML that does not give a list where one is needed', () => {
  it('is refused, not read as an empty board', () => {
    expect(() => fromYaml('title: t\ndevices: {pc: {name: X}}\n', blank())).toThrow(/devices: 一覧で/);
    expect(() => fromYaml('title: t\ncables: "a.x -> b.y"\n', blank())).toThrow(/cables: 一覧で/);
    expect(() => fromYaml('title: t\ndevices:\n  - { id: pc, name: PC, in: "HDMI:video" }\n', blank())).toThrow(/devices\[0\]\.in: 一覧で/);
  });

  it('still reads a section left out as empty', () => {
    expect(fromYaml('title: t\n', blank()).nodes).toEqual([]);
  });
});

describe('a cable written from an input to an output', () => {
  it('is turned round, so power is counted from its source', async () => {
    const { powerLoads } = await import('../src/model/lists');
    const doc = fromYaml(`title: t
devices:
  - { id: pj, name: PJ, watts: 300, in: [AC:power] }
  - { id: tap, name: タップ, capacity: 1500, in: [IN:power], out: [AC 1:power] }
cables:
  - { from: pj.AC, to: tap.AC 1, type: power }
`, blank());
    expect(doc.edges[0].from.node).toBe('tap');
    expect(powerLoads(doc).get('tap')?.watts).toBe(300);
  });
});

describe('YAML keeps what is less often written', () => {
  it('keeps the order things are drawn in, a flow note and an area with no name', () => {
    const d = sample();
    const sticky = { id: 'memo', type: 'sticky' as const, x: 0, y: 0, w: 100, h: 60, text: 'メモ', color: 'yellow' as const };
    const area = { id: 'a0', type: 'frame' as const, x: -500, y: -500, w: 200, h: 100, text: '' };
    const [x, y] = d.nodes.filter((n) => n.type === 'device');
    const flow = { id: 'f1', from: { node: x.id }, to: { node: y.id }, signal: 'flow', label: '', length: null, note: '確認する', arrow: 'end' as const };
    // The note over everything, drawn last.
    const doc = { ...d, nodes: [area, ...d.nodes, sticky], edges: [...d.edges, flow] };
    const back = fromYaml(toYaml(doc), doc);
    expect(back.nodes.map((n) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    expect(back.edges.find((e) => e.id === 'f1')?.note).toBe('確認する');
  });

  it('refuses a flow arrow written among the cables', () => {
    expect(() => fromYaml('title: t\nshapes:\n  - { id: a, text: A }\n  - { id: b, text: B }\ncables:\n  - { from: a, to: b, type: flow }\n', blank())).toThrow(/flows に/);
  });
});

describe('a port name on both sides of a box', () => {
  it('is the output where the line comes from the box, the input where it goes in', () => {
    const doc = fromYaml(`kind: software
devices:
  - { id: cdn, name: CDN, out: [HTTPS:http] }
  - { id: waf, name: WAF, in: [HTTPS:http], out: [HTTPS:http] }
  - { id: lb, name: LB, in: [HTTPS:http] }
cables:
  - { from: cdn.HTTPS, to: waf.HTTPS, type: http }
  - { from: waf.HTTPS, to: lb.HTTPS, type: http }
`, blank());
    const waf = doc.nodes.find((n) => n.id === 'waf') as DeviceNode;
    const side = (port?: string) => waf.ports.find((p) => p.id === port)?.side;
    expect(side(doc.edges[0].to.port)).toBe('left');
    expect(side(doc.edges[1].from.port)).toBe('right');
    // Written back, each end says which of the two it is, and reads back the same.
    const back = fromYaml(toYaml(doc), blank());
    expect(back.edges.map((e) => [e.from.port, e.to.port])).toEqual(doc.edges.map((e) => [e.from.port, e.to.port]));
  });
});
