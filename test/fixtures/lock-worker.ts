// One of several processes adding to one board at once (see lock.test.ts): each adds `count`
// nodes, every one written on the version just read, again on a refusal.
import { Busy, Conflict, store } from '../../server/store';

const [root, who, count] = process.argv.slice(2);
const s = store(root);
for (let i = 0; i < Number(count); i++) {
  for (;;) {
    const doc = s.read('shared1')!;
    try {
      s.write({ ...doc, nodes: [...doc.nodes, `${who}-${i}`] }, Number(doc.serial) || 0);
      break;
    } catch (e) {
      if (!(e instanceof Conflict || e instanceof Busy)) throw e;
    }
  }
}
