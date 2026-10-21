import { useState } from 'react';
import { safeUrl } from '../../model/url';
import { colourKey, ipIssues, quantityOf, unitsOf } from '../../model/lists';
import { freshId } from '../../model/presets';
import { kindOf } from '../../model/kinds';
import { linkClick } from '../../platform/io';
import { useStore } from '../../model/store';
import { type DeviceNode, type Port } from '../../model/types';
import { RunsOn, SharedSection } from '../Shared';
import { Field, Section, Head, SUPPLY_CATEGORY, CategoryField, Colors, SignalSelect, SignalHowTo, PortName, num } from './fields';

export function DevicePanel({ n }: { n: DeviceNode }) {
  // On a software board a device is a piece of software: its fields are those of software.
  const soft = useStore((s) => kindOf(s.doc).id === 'software');
  const st = useStore.getState;
  const patch = (p: Partial<DeviceNode>, record = false) => st().updateNode(n.id, p, record);
  const link = safeUrl(n.url);
  const saved = useStore((s) => s.presets.some((p) => p.name === n.text && p.maker === n.maker && p.model === n.model && !!p.software === (kindOf(s.doc).id === 'software')));
  const setPort = (id: string, p: Partial<Port>, record: boolean) => patch({ ports: n.ports.map((x) => (x.id === id ? { ...x, ...p } : x)) }, record);
  const addPort = (side: Port['side']) => {
    // A name of its own (IN, IN 2, IN 3 …), so a cable can always tell its port from the others.
    const base = side === 'left' ? 'IN' : 'OUT';
    const names = new Set(n.ports.map((p) => p.name));
    let name = base;
    for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
    patch({ ports: [...n.ports, { id: freshId(new Set(n.ports.map((p) => p.id)), 'p'), name, side, signal: soft ? 'data' : 'video' }] }, true);
  };
  const removePort = (id: string) =>
    st().mutate((d) => ({
      ...d,
      nodes: d.nodes.map((x) => (x.id === n.id ? { ...n, ports: n.ports.filter((p) => p.id !== id) } : x)),
      edges: d.edges.filter((e) => !((e.from.node === n.id && e.from.port === id) || (e.to.node === n.id && e.to.port === id))),
    }));
  // Supplying power is what the 電源 category means (UPS, taps, distribution boards); a capacity
  // already typed in stays in view whatever the category, so it is never hidden from the user.
  const supplies = n.category.trim() === SUPPLY_CATEGORY;
  // Network settings only matter for things on the network: shown for a device with a LAN port or
  // settings already typed in, and one click away for the rest (a Wi-Fi device, say).
  const [asked, setNetworked] = useState(false);
  // A box is one unit as a rule: the quantity is shown only for one that stands for several.
  const [manyAsked, setMany] = useState(false);
  const many = !soft && (manyAsked || n.qty != null || quantityOf(n.text).count > 1);
  const networked = asked || !!n.ip || !!n.host || n.ports.some((p) => p.signal === 'lan');
  const group = useStore((s) => colourKey(s.doc).get(n.color ?? 'gray') ?? '');
  const ipIssue = useStore((s) => ipIssues(s.doc).get(n.id));
  // The first other device holding the same address, by name, so the clash can be found.
  const clash = useStore((s) => {
    const ip = n.ip?.trim().replace(/\/\d+$/, '').toLowerCase();
    const other = ip && s.doc.nodes.find((x) => x.id !== n.id && x.type === 'device' && x.ip?.trim().replace(/\/\d+$/, '').toLowerCase() === ip);
    return other ? other.text.split('\n')[0] : '';
  });
  const move = (id: string, dir: -1 | 1) => {
    const port = n.ports.find((p) => p.id === id)!;
    const same = n.ports.filter((p) => p.side === port.side);
    const other = same[same.indexOf(port) + dir];
    if (!other) return;
    patch({ ports: n.ports.map((p) => (p === port ? other : p === other ? port : p)) }, true);
  };
  const ports = (side: Port['side']) => n.ports.filter((p) => p.side === side);
  return (
    <>
      <Head title={soft ? '部品' : '機材'} id={n.id} />
      <Section title="基本情報">
        <Field wrap label="名称（改行できます）" value={n.text} onChange={(v) => patch({ text: v })} />
        {/* A device's category has the row to itself; a piece of software's shares it with its version. */}
        {soft ? (
          <div className="grid2">
            <CategoryField id={n.id} soft value={n.category} onChange={(v, record) => patch({ category: v }, record)} />
            <Field label="バージョン・実装" placeholder="例: Node 22 / TD 2025" value={n.model} onChange={(v) => patch({ model: v })} />
          </div>
        ) : (
          <CategoryField id={n.id} value={n.category} onChange={(v, record) => patch({ category: v }, record)} />
        )}
        {!soft && (
          <div className="grid2">
            <Field label="メーカー" value={n.maker} onChange={(v) => patch({ maker: v })} />
            <Field
              label="型番"
              value={n.model}
              onChange={(v) => patch({ model: v })}
              // A web address pasted here is the model's link, not its name.
              onPasteText={(text) => {
                if (!/^https?:\/\//i.test(text.trim()) || !safeUrl(text)) return false;
                patch({ url: text.trim() }, true);
                return true;
              }}
            />
          </div>
        )}
        <Field label={soft ? 'リンク（リポジトリ・資料など）' : '型番のリンク（製品ページなど）'} placeholder="https://…" value={n.url ?? ''} onChange={(v) => patch({ url: v || undefined })} />
        {n.url &&
          (link ? (
            <a className="open-link" href={link} target="_blank" rel="noopener noreferrer" onClick={linkClick(link)}>
              {link.replace(/^https?:\/\/(www\.)?/, '')} を開く ↗
            </a>
          ) : (
            <p className="error">Web のアドレス（https://…）として読めません。</p>
          ))}
        <Field wrap label="備考" value={n.note} onChange={(v) => patch({ note: v })} />
      </Section>
      {/* A piece of software has no quantity, price, power or supplier: those belong to the gear it runs on. */}
      {!soft && (
        <Section title="手配" note="機材リストに出ます">
          <Field label="手配先・担当（区分）" placeholder="例: 自社 / レンタル / 先方支給" value={n.vendor ?? ''} onChange={(v) => patch({ vendor: v || undefined })} />
          {/* What the board's colour key says is only a guess (the colours may mean something else),
              so it is offered, never written in unasked. */}
          {group && group !== (n.vendor?.trim() ?? '') && (
            <p className="suggest">
              <span>{n.vendor?.trim() ? <>色分けでは「{group}」</> : <>空欄のときは色分けの「{group}」を表に使います</>}</span>
              <button className="mini" onClick={() => patch({ vendor: group }, true)}>
                入れる
              </button>
            </p>
          )}
          {many && (
            <div className="grid2">
              <Field label="数量（この枠の台数）" type="number" placeholder={`${quantityOf(n.text).count}（名前から）`} value={n.qty == null ? '' : String(n.qty)} onChange={(v) => patch({ qty: num(v) && num(v)! >= 1 ? Math.round(num(v)!) : undefined })} />
            </div>
          )}
          {/* Prices are typed in the equipment list, where the rows can be gone down one after another. */}
          <p className="hint price-hint">
            {n.price != null ? <>単価 {n.price.toLocaleString('ja-JP')} 円{unitsOf(n).count > 1 && <>（金額 {(n.price * unitsOf(n).count).toLocaleString('ja-JP')} 円）</>}。</> : <>単価は</>}
            <button className="link" onClick={() => st().setPanel('lists')}>
              機材リスト
            </button>
            {n.price != null ? 'で変えられます。' : 'の「単価(円)」欄に入力します。'}
          </p>
          {!many && (
            <button className="mini add-field" onClick={() => setMany(true)}>
              ＋数量（1 枠で複数台を表すとき）
            </button>
          )}
        </Section>
      )}
      {!soft && (
        <Section title="電源" note="電源系統表に出ます">
          <div className="grid2">
            <Field label="消費電力 (W)" type="number" value={n.watts == null ? '' : String(n.watts)} onChange={(v) => patch({ watts: num(v) })} />
            {(supplies || n.capacity != null) && <Field label="給電容量 (W)" type="number" placeholder="UPS・タップ" value={n.capacity == null ? '' : String(n.capacity)} onChange={(v) => patch({ capacity: num(v) })} />}
          </div>
        </Section>
      )}
      <Section title={soft ? '動作環境' : 'ネットワーク'}>
        {soft && <RunsOn n={n} />}
        {soft && n.runsOn && (
          <p className="hint">
            ホスト名 {n.host || '—'}／IP {n.ip || '—'}（動作ホストの機材から）
          </p>
        )}
        {(networked || soft) && !(soft && n.runsOn) && (
          <div className="grid2">
            <Field label={soft ? '動作ホストの IP' : 'IP アドレス'} placeholder="192.168.0.10" value={n.ip ?? ''} onChange={(v) => patch({ ip: v || undefined })} />
            <Field label={soft ? '動作ホスト名' : 'ホスト名'} placeholder={soft ? '例: td-main / AWS' : undefined} value={n.host ?? ''} onChange={(v) => patch({ host: v || undefined })} />
          </div>
        )}
        {networked && ipIssue === 'bad' && <p className="error">IPv4 アドレス（192.168.0.10 の形）として読めません。</p>}
        {networked && ipIssue === 'dup' && <p className="error">{clash ? `「${clash}」と` : 'ほかの機材と'}同じ IP アドレスです。</p>}
        {!networked && !soft && (
          <button className="mini add-field" onClick={() => setNetworked(true)}>
            ＋IP アドレス・ホスト名
          </button>
        )}
      </Section>
      <Section title="見た目">
        <label className="field">
          <span>色分け</span>
          <Colors value={n.color ?? 'gray'} onPick={(color) => patch({ color }, true)} />
        </label>
      </Section>
      {(['left', 'right'] as const).map((side) => (
        <Section
          key={side}
          title={side === 'left' ? '入力ポート（左）' : '出力ポート（右）'}
          note={`${ports(side).length} 個`}
          action={
            <button className="mini" onClick={() => addPort(side)}>
              ＋追加
            </button>
          }
        >
          {ports(side).length > 0 && (
            <div className="port-head">
              <span>名前</span>
              <span>種別</span>
            </div>
          )}
          {ports(side).map((p) => (
            <div className="port-row" key={p.id}>
              <PortName value={p.name} onChange={(v) => setPort(p.id, { name: v }, false)} />
              <SignalSelect value={p.signal} onChange={(v) => setPort(p.id, { signal: v }, true)} />
              <button className="mini" onClick={() => move(p.id, -1)} title="上へ">↑</button>
              <button className="mini" onClick={() => move(p.id, 1)} title="下へ">↓</button>
              <button className="mini" onClick={() => setPort(p.id, { side: side === 'left' ? 'right' : 'left' }, true)} title="反対側へ">⇄</button>
              <button className="mini danger" onClick={() => removePort(p.id)} title="削除">×</button>
            </div>
          ))}
          {!ports(side).length && <p className="hint">ポートはありません。</p>}
        </Section>
      ))}
      {!soft && <SignalHowTo port />}
      <SharedSection n={n} />
      <button className="wide" title="名称・メーカー・型番・ポート構成などを、機材ライブラリの「マイプリセット」に保存します" onClick={() => st().savePreset(n.id)}>
        {saved ? 'マイプリセットを上書き保存' : 'マイプリセットに保存'}
      </button>
    </>
  );
}
