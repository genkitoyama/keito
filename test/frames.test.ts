import { describe, expect, it } from 'vitest';
import { framesInOrder } from '../src/canvas/render';
import { fromYaml } from '../src/model/dsl';
import { PALETTE } from '../src/model/signals';
import { blank } from './helpers';

describe('area frames', () => {
  it('are drawn outside in, so an area within another lies on top of it', () => {
    // The subnet comes first on the board, the network round it after.
    const doc = fromYaml(
      `areas:
  - { name: サブネット, rect: [40, 60, 200, 160], color: blue }
  - { name: 別の場所, rect: [600, 0, 200, 200] }
  - { name: VPC, rect: [0, 0, 400, 300], color: purple }
`,
      blank('frames'),
    );
    expect(framesInOrder(doc).map((n) => n.text)).toEqual(['別の場所', 'VPC', 'サブネット']);
  });

  it('give blue and purple tints of different hues', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
      return ((h * 60) % 360 + 360) % 360;
    };
    for (const k of ['fill', 'stroke'] as const) expect(Math.abs(hue(PALETTE.purple[k]) - hue(PALETTE.blue[k]))).toBeGreaterThan(90);
  });
});
