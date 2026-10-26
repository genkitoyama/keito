import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { getSetting, setSetting } from '../platform/io';
import { openBoards } from './Boards';

/** A project as last opened on this machine: when, and the board it was left on. */
interface Visit {
  project: string;
  board: string;
  at: number;
}
const VISITS = 'recentProjects';

function visits(): Visit[] {
  try {
    const v: unknown = JSON.parse(getSetting(VISITS) || '[]');
    return Array.isArray(v) ? v.filter((x): x is Visit => typeof x?.project === 'string' && typeof x?.board === 'string' && typeof x?.at === 'number') : [];
  } catch {
    return [];
  }
}

/** Remember the board on screen as where its project was left. */
export function noteVisit(project: string, board: string): void {
  setSetting(VISITS, JSON.stringify([{ project, board, at: Date.now() }, ...visits().filter((v) => v.project !== project)].slice(0, 30)));
}

/** ⌘K, from anywhere on the board. */
export const toggleProjectMenu = (): void => void window.dispatchEvent(new Event('keito:project-menu'));

const label = (p: string): string => p || '案件なし';

/**
 * The project on screen, and a menu of the others to jump to: the last opened first (on this
 * machine), each opening on the board it was left on. 1–9 pick one, the arrows and Enter too.
 * The full list of projects and boards is one step further, at the foot.
 */
export function ProjectMenu() {
  const st = useStore.getState;
  const doc = useStore((s) => s.doc);
  const boards = useStore((s) => s.boards);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  // The row the keys act on, read by the key handler as it is now.
  const atRef = useRef(0);
  atRef.current = at;
  const mine = doc.meta.project?.trim() ?? '';

  useEffect(() => noteVisit(mine, doc.id), [mine, doc.id]);
  useEffect(() => {
    const flip = () => setOpen((o) => !o);
    window.addEventListener('keito:project-menu', flip);
    return () => window.removeEventListener('keito:project-menu', flip);
  }, []);

  // The other projects, the last visited first, then the last worked on.
  const others = useMemo(() => {
    if (!open) return [];
    const seen = new Map(visits().map((v) => [v.project, v]));
    const groups = new Map<string, { count: number; updated: number; latest: string }>();
    for (const b of boards) {
      const p = b.project?.trim() ?? '';
      if (p === mine || b.id === doc.id) continue;
      const g = groups.get(p) ?? { count: 0, updated: 0, latest: b.id };
      if (b.updated > g.updated) Object.assign(g, { updated: b.updated, latest: b.id });
      g.count++;
      groups.set(p, g);
    }
    return [...groups]
      .map(([project, g]) => {
        const v = seen.get(project);
        // The board it was left on, if it is still there; else the one last worked on.
        const board = v && boards.some((b) => b.id === v.board && (b.project?.trim() ?? '') === project) ? v.board : g.latest;
        return { project, count: g.count, board, at: v?.at ?? 0, updated: g.updated };
      })
      .sort((a, b) => b.at - a.at || b.updated - a.updated);
  }, [open, boards, mine, doc.id]);
  const here = boards.filter((b) => (b.project?.trim() ?? '') === mine && b.id !== doc.id).length + 1;

  const go = (board: string) => {
    setOpen(false);
    st().openBoard(board);
  };
  const all = () => {
    setOpen(false);
    openBoards();
  };

  useEffect(() => {
    if (!open) return;
    setAt(0);
    // While the menu is open it takes the keys, before the board does.
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, others.length)) go(others[n - 1].board);
      else if (e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, others.length));
      else if (e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0));
      else if (e.key === 'Enter') {
        if (atRef.current < others.length) go(others[atRef.current].board);
        else all();
      }
      else if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) setOpen(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, others]);

  return (
    <div className="project-switch">
      <button className="board-switch" onClick={() => setOpen((o) => !o)} data-tip={open ? undefined : 'ほかの案件へ（⌘K）'}>
        <span>{label(mine)}</span>
        <i>▾</i>
      </button>
      {open && (
        <>
          <div className="project-menu-bg" onPointerDown={() => setOpen(false)} />
          <div className="project-menu" role="menu">
            <div className="project-item here">
              <span className="name">{label(mine)}</span>
              <small>{here} 枚 · 表示中</small>
            </div>
            {others.length > 0 && <div className="project-menu-head">最近開いた案件</div>}
            {others.map((p, i) => (
              <button key={p.project || '-'} role="menuitem" className={`project-item${at === i ? ' on' : ''}`} onPointerEnter={() => setAt(i)} onClick={() => go(p.board)}>
                {i < 9 ? <kbd>{i + 1}</kbd> : <kbd className="none" />}
                <span className="name">{label(p.project)}</span>
                <small>{p.count} 枚</small>
              </button>
            ))}
            <button role="menuitem" className={`project-item all${at === others.length ? ' on' : ''}`} onPointerEnter={() => setAt(others.length)} onClick={all}>
              すべての案件とボード…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
