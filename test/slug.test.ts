import { describe, expect, it } from 'vitest';
import cases from './slug-cases.json';
import { slug } from '../server/store';
import { readSerial } from '../src/model/load';

describe('folder names and version numbers', () => {
  // The same cases are run by the desktop app's Rust tests (store.rs): both must name folders alike,
  // or each would rename the folder back to its own name on every write.
  it('names a board folder as the desktop app does', () => {
    for (const [title, folder] of cases as [string, string][]) expect(slug(title), JSON.stringify(title)).toBe(folder);
  });

  it('reads a version number as the desktop app does', () => {
    for (const [v, n] of [[5, 5], ['5', 5], [5.0, 5], [-1, 0], ['x', 0], [null, 0]] as const) expect(readSerial(v)).toBe(n);
  });
});
