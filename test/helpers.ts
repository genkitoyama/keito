import { fromYaml } from '../src/model/dsl';
import { SAMPLE_YAML } from '../src/model/sample';
import type { Doc } from '../src/model/types';

/** An empty board to build on. */
export const blank = (id = 'test'): Doc => ({ version: 1, id, meta: { title: '', project: '' }, nodes: [], edges: [] });

/** The sample board every new user sees: devices, cables, flows, a sticky and a sequence. */
export const sample = (): Doc => fromYaml(SAMPLE_YAML, blank('sample'));
