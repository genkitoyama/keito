import { describe, expect, it } from 'vitest';
import { parseSequence, seqBlocks, seqPlace } from '../src/model/sequence';

describe('blocks', () => {
  it('frames loop and alt, with else splitting the alt and blocks nested inside', () => {
    const d = parseSequence(['A -> B: 1', 'loop 毎フレーム', 'alt 人がいる', 'B -> A: 2', 'else いない', 'B -> A: 3', 'end', 'end'].join('\n'));
    const blocks = seqBlocks(d);
    expect(blocks.map((b) => [b.kind, b.label, b.depth])).toEqual([
      ['loop', '毎フレーム', 0],
      ['alt', '人がいる', 1],
    ]);
    expect(blocks[1].splits.map((s) => s.label)).toEqual(['いない']);
    // Each block closes at its own `end`, the inner one first.
    expect(blocks[1].end).toBeLessThan(blocks[0].end);
  });

  it('frames a block left open down to the bottom', () => {
    const d = parseSequence(['loop 3回', 'A -> B: 1'].join('\n'));
    expect(seqBlocks(d)[0].end).toBe(d.items.length);
  });
});

describe('text that wraps', () => {
  const long = 'カメラにアクセスして初期化し、ライブビューを設定する';
  const n = (text: string, h = 0) => ({ x: 0, y: 0, w: 0, h, text });

  it('stacks a wrapped message above its arrow, clear of the row before', () => {
    const { items } = seqPlace(n(['participant A', 'participant B', 'A -> B: 前', `A -> B: ${long}`].join('\n')));
    expect(items[1].lines.length).toBeGreaterThan(1);
    expect(items[1].top).toBeGreaterThan(items[0].bottom);
    // The text stays above the arrow.
    expect(items[1].textY).toBeLessThan(items[1].y);
  });

  it('keeps a wrapped note clear of the next message, even with the rows squeezed', () => {
    const src = ['participant A', 'participant B', 'participant C', `note over B: ${long}`, 'A -> C: 次'].join('\n');
    for (const h of [0, 1]) {
      const { items } = seqPlace(n(src, h));
      expect(items[0].lines.length).toBeGreaterThan(1);
      expect(items[1].top).toBeGreaterThan(items[0].bottom);
    }
  });
});

describe('reading messages', () => {
  const msgs = (src: string) => {
    const d = parseSequence(src);
    return d.items.flatMap((it) => (it.kind === 'msg' ? [`${d.participants[it.from].id}>${d.participants[it.to].id}:${it.text}${it.dashed ? ':dashed' : ''}${it.cross ? ':x' : ''}`] : []));
  };

  it('reads the arrows of Mermaid and PlantUML', () => {
    expect(msgs(['A->>B: one', 'B-->>A: two', 'A ->+ B: three', 'B --x A: four', 'A <- B: five', 'A-)B: six'].join('\n'))).toEqual([
      'A>B:one',
      'B>A:two:dashed',
      'A>B:three',
      'B>A:four:dashed:x',
      'B>A:five',
      'A>B:six',
    ]);
  });

  it('keeps a name with "-x" in it whole', () => {
    expect(msgs('my-xbox -> TV: on')).toEqual(['my-xbox>TV:on']);
    expect(msgs('TV -> my-xbox: on')).toEqual(['TV>my-xbox:on']);
  });

  it('takes no message without both ends', () => {
    expect(msgs('A -> : hi')).toEqual([]);
    expect(parseSequence('A -> : hi').participants).toEqual([]);
  });

  it('numbers a return only when it answers something', () => {
    expect(msgs(['autonumber', 'return ok', 'A -> B: hi', 'return done'].join('\n'))).toEqual(['A>B:1. hi', 'B>A:2. done:dashed']);
  });

  it('does not let a note still being typed swallow the lines after it', () => {
    const d = parseSequence(['participant A', 'note over A', 'A -> B: kept', 'note over A', 'two', 'end note'].join('\n'));
    expect(d.items.map((it) => it.kind)).toEqual(['note', 'msg', 'note']);
  });
});
