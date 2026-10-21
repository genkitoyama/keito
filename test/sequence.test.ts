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
