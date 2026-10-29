import { useEffect, useLayoutEffect, useRef } from 'react';
import { copySelection, duplicateSelection, pasteClipboard, restack, useStore } from '../model/store';
import { isUnderlay } from '../model/geometry';
import { copyText } from '../platform/io';

const st = useStore.getState;

/**
 * The menu a right-click opens on the board: what the keys do, for those who look for it here, and
 * the drawing order (in front, behind), which has no key. `at` is in the canvas's own pixels.
 */
export function ContextMenu({ at, close }: { at: { x: number; y: number }; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept inside the board near its edges: opened leftwards or upwards when there is no room.
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    if (at.x + el.offsetWidth > host.clientWidth - 4) el.style.left = `${Math.max(4, at.x - el.offsetWidth)}px`;
    if (at.y + el.offsetHeight > host.clientHeight - 4) el.style.top = `${Math.max(4, at.y - el.offsetHeight)}px`;
  });
  const selection = useStore((s) => s.selection);
  const nodes = useStore((s) => s.doc.nodes.filter((n) => s.selection.includes(n.id)).length);
  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('.context-menu')) return;
      close();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', away, true);
    window.addEventListener('wheel', away, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', away, true);
      window.removeEventListener('wheel', away, true);
      window.removeEventListener('blur', close);
    };
  }, [close]);
  const item = (label: string, keys: string, run: () => void, off = false) => (
    <button
      disabled={off}
      onClick={() => {
        close();
        run();
      }}
    >
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </button>
  );
  const copy = () => {
    if (copySelection()) copyText('').catch(() => {});
  };
  return (
    <div ref={ref} className="context-menu" style={{ left: at.x, top: at.y }} onContextMenu={(e) => e.preventDefault()}>
      {selection.length > 0 && (
        <>
          {item('コピー', '⌘C', copy, !nodes)}
          {item('切り取り', '⌘X', () => {
            copy();
            st().removeIds(st().selection);
          }, !nodes)}
        </>
      )}
      {item('貼り付け', '⌘V', () => pasteClipboard())}
      {selection.length > 0 && (
        <>
          {item('複製', '⌘D', () => duplicateSelection(), !nodes)}
          <hr />
          {item('最前面へ', '', () => restack('front'), !nodes)}
          {item('最背面へ', '', () => restack('back'), !nodes)}
          <hr />
          {item('削除', 'Delete', () => st().removeIds(st().selection))}
        </>
      )}
      {selection.length === 0 && item('すべて選択', '⌘A', () => st().select([...st().doc.nodes.filter((n) => !isUnderlay(n)).map((n) => n.id), ...st().doc.edges.map((e) => e.id)]))}
    </div>
  );
}
