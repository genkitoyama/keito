import { align, useStore } from '../model/store';
import { Section, Head } from './inspector/fields';
import { MetaPanel } from './inspector/MetaPanel';
import { NodePanel } from './inspector/NodePanel';
import { EdgePanel } from './inspector/EdgePanel';

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const remove = () => useStore.getState().removeIds(selection);
  const lines = doc.edges.filter((e) => selection.includes(e.id)).length;
  let body;
  if (selection.length === 0) body = <MetaPanel />;
  else if (selection.length === 1) {
    const node = doc.nodes.find((n) => n.id === selection[0]);
    const edge = doc.edges.find((e) => e.id === selection[0]);
    body = node ? <NodePanel key={node.id} n={node} /> : edge ? <EdgePanel key={edge.id} e={edge} /> : null;
  } else {
    body = (
      <>
        <Head title={`${selection.length} 個を選択中`} />
        {lines > 0 && <p className="hint">{lines === selection.length ? `線 ${lines} 本` : `うち線 ${lines} 本`}。Delete キーか下の「削除」で消せます。</p>}
        {selection.length - lines >= 2 && (
          <Section title="整列">
            <div className="grid2">
              <button onClick={() => align('left')}>左揃え</button>
              <button onClick={() => align('top')}>上揃え</button>
              <button onClick={() => align('hcenter')}>左右中央</button>
              <button onClick={() => align('vcenter')}>上下中央</button>
              <button onClick={() => align('hspace')}>横に等間隔</button>
              <button onClick={() => align('vspace')}>縦に等間隔</button>
            </div>
          </Section>
        )}
      </>
    );
  }
  return (
    <aside className="inspector">
      {body}
      {selection.length > 0 && <button className="danger wide" onClick={remove}>削除</button>}
    </aside>
  );
}
