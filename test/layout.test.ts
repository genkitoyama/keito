import { describe, expect, it } from 'vitest';
import { fromYaml } from '../src/model/dsl';
import { blank } from './helpers';

// A layered web system: a worker that takes jobs off a queue and a webhook coming back from outside
// both point "backwards", against the way most lines between those areas go.
const WEB = `kind: software
areas:
  - { name: 利用者 }
  - { name: 外部 }
  - { name: データ }
  - { name: アプリ }
  - { name: 公開 }
devices:
  - { id: browser, name: ブラウザ, area: 利用者, out: [HTTPS:http] }
  - { id: lb, name: LB, area: 公開, in: [HTTPS:http], out: [HTTP:http] }
  - { id: api, name: API, area: アプリ, in: [HTTP:http], out: [DB:tcp, Queue:http, 決済:http] }
  - { id: worker, name: ワーカー, area: アプリ, in: [Queue:http], out: [DB:tcp] }
  - { id: db, name: DB, area: データ, in: [DB:tcp] }
  - { id: queue, name: キュー, area: データ, in: [HTTPS:http], out: [Queue:http] }
  - { id: pay, name: 決済, area: 外部, in: [HTTPS:http], out: [Webhook:http] }
cables:
  - { from: browser.HTTPS, to: lb.HTTPS, type: http }
  - { from: lb.HTTP, to: api.HTTP, type: http }
  - { from: api.DB, to: db.DB, type: tcp }
  - { from: api.Queue, to: queue.HTTPS, type: http }
  - { from: queue.Queue, to: worker.Queue, type: http }
  - { from: worker.DB, to: db.DB, type: tcp }
  - { from: api.決済, to: pay.HTTPS, type: http }
  - { from: pay.Webhook, to: lb.HTTPS, type: http }
`;

describe('auto layout', () => {
  it('sets the areas out left to right the way the flow goes, whatever the order they are listed in', () => {
    const doc = fromYaml(WEB, blank('web'), true);
    const frames = doc.nodes.filter((n) => n.type === 'frame').sort((a, b) => a.x - b.x);
    expect(frames.map((f) => (f as { text?: string }).text)).toEqual(['利用者', '公開', 'アプリ', 'データ', '外部']);
  });

  it('keeps an area one column wide when its parts only meet across areas', () => {
    const doc = fromYaml(WEB, blank('web'), true);
    const x = (id: string) => doc.nodes.find((n) => n.id === id)!.x;
    expect(x('api')).toBe(x('worker'));
    expect(x('db')).toBe(x('queue'));
  });
});
