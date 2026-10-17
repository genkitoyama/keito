import { useMemo, useState } from 'react';
import { type BoardKind, KINDS, KIND_ORDER } from '../model/kinds';
import { startBoard, useStore } from '../model/store';
import type { BoardInfo } from '../platform/storage';

/** The boards window opens on the list, or straight on the form for a new board. */
let startWithForm = false;
export function openBoards(create = false): void {
  startWithForm = create;
  useStore.getState().setPanel('boards');
}

const NO_PROJECT = '';
const projectLabel = (p: string): string => p || '案件なし';

function when(t: number): string {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Projects and their boards. Boards are grouped by their project (案件名); each says what kind it
 * is. A new board is made here by choosing its kind, and a project can be renamed for all its
 * boards at once.
 */
export function BoardsPanel() {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const boards = useStore((s) => s.boards);
  // The board on screen as it is now (its title or project may have just been edited).
  const all: BoardInfo[] = useMemo(() => {
    const here: BoardInfo = { id: doc.id, title: doc.meta.title, updated: Date.now(), project: doc.meta.project || undefined, kind: doc.kind };
    return [here, ...boards.filter((b) => b.id !== doc.id)];
  }, [boards, doc.id, doc.meta.title, doc.meta.project, doc.kind]);
  const projects = useMemo(() => {
    const latest = new Map<string, number>();
    for (const b of all) latest.set(b.project ?? NO_PROJECT, Math.max(latest.get(b.project ?? NO_PROJECT) ?? 0, b.updated));
    // The open board's project first, then the most recently worked on.
    const mine = doc.meta.project ?? NO_PROJECT;
    return [...latest.keys()].sort((a, b) => (a === mine ? -1 : b === mine ? 1 : (latest.get(b) ?? 0) - (latest.get(a) ?? 0)));
  }, [all, doc.meta.project]);
  const [project, setProject] = useState(doc.meta.project ?? NO_PROJECT);
  const [form, setForm] = useState<{ kind: BoardKind; title: string; project: string } | null>(() =>
    startWithForm ? { kind: 'system', title: '', project: doc.meta.project ?? NO_PROJECT } : null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const shown = all.filter((b) => (b.project ?? NO_PROJECT) === project).sort((a, b) => b.updated - a.updated);
  const close = () => st().setPanel(null);

  return (
    <div className="modal-bg" onPointerDown={close}>
      <div className="modal boards" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>ボード一覧</h2>
          <button onClick={close}>×</button>
        </header>
        <div className="modal-body cols">
          <div className="col side projects">
            <h4>案件</h4>
            {projects.map((p) => (
              <button key={p || '-'} className={`project${p === project ? ' on' : ''}`} onClick={() => setProject(p)}>
                <span>{projectLabel(p)}</span>
                <small>{all.filter((b) => (b.project ?? NO_PROJECT) === p).length}</small>
              </button>
            ))}
            {!projects.includes(project) && (
              <button className="project on">
                <span>{projectLabel(project)}</span>
                <small>0</small>
              </button>
            )}
            {/* A project comes into being with its first board: the form asks for both. */}
            <button className="mini new-project" onClick={() => setForm({ kind: 'system', title: '', project: '' })}>
              ＋ 新しい案件
            </button>
          </div>
          <div className="col">
            <div className="project-head">
              {renaming !== null ? (
                <input
                  autoFocus
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && renaming.trim()) {
                      st().renameProject(project, renaming);
                      setProject(renaming.trim());
                      setRenaming(null);
                    } else if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <h3>{projectLabel(project)}</h3>
              )}
              {renaming === null && project !== NO_PROJECT && shown.length > 0 && (
                <button className="mini" data-tip="この案件のボードすべての案件名を変えます" onClick={() => setRenaming(project)}>
                  名前を変える
                </button>
              )}
              <span className="grow" />
              {!form && (
                <button className="primary" onClick={() => setForm({ kind: 'system', title: '', project })}>
                  ＋ 新しいボード
                </button>
              )}
            </div>
            {form && (
              <div className="new-board">
                <div className="kinds">
                  {KIND_ORDER.map((k) => (
                    <button key={k} className={`kind-card${form.kind === k ? ' on' : ''}`} onClick={() => setForm({ ...form, kind: k })}>
                      <b className={`kind-badge ${k}`}>{KINDS[k].label}</b>
                      <small>{KINDS[k].hint}</small>
                    </button>
                  ))}
                </div>
                <div className="row">
                  <input autoFocus placeholder={`ボードの名前（空なら「${KINDS[form.kind].label}」）`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  <input list="keito-projects" placeholder="案件名" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
                  <datalist id="keito-projects">
                    {projects.filter(Boolean).map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <button
                    className="primary"
                    onClick={() => {
                      st().newBoard(startBoard(form.kind, form.title, form.project));
                      close();
                    }}
                  >
                    作る
                  </button>
                  <button onClick={() => setForm(null)}>やめる</button>
                </div>
              </div>
            )}
            <div className="board-cards">
              {shown.map((b) => (
                <button
                  key={b.id}
                  className={`board-card${b.id === doc.id ? ' on' : ''}`}
                  onClick={() => {
                    if (b.id !== doc.id) st().openBoard(b.id);
                    close();
                  }}
                >
                  <b className={`kind-badge ${b.kind ?? 'system'}`}>{KINDS[b.kind ?? 'system']?.label ?? 'システム図'}</b>
                  <span className="title">{b.title}</span>
                  <small>{b.id === doc.id ? '表示中' : when(b.updated)}</small>
                </button>
              ))}
              {!shown.length && !form && <p className="hint">この案件にはまだボードがありません。「＋ 新しいボード」から作れます。</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
