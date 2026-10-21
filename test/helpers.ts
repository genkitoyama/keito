import { fromYaml } from '../src/model/dsl';
import { SAMPLE_BOARDS } from '../src/model/sample';
import type { Doc } from '../src/model/types';

/** An empty board to build on. */
export const blank = (id = 'test'): Doc => ({ version: 1, id, meta: { title: '', project: '' }, nodes: [], edges: [] });

/** The system diagram of the sample project every new user sees: devices, cables, areas, power. */
export const sample = (): Doc => fromYaml(SAMPLE_BOARDS[0], blank('sample'));

/** Each board of the sample project, read as the app reads it. */
export const sampleProject = (): Doc[] => SAMPLE_BOARDS.map((yaml, i) => fromYaml(yaml, blank(`sample${i}`)));
