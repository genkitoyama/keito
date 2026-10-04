/**
 * Hover tips (`data-tip`) show at once and put themselves away again: a tip is
 * visible only while the pointer has moved over its element within the last
 * few seconds, so it never sits on top of the thing you are looking at.
 */
const LINGER = 3000;
let shown: Element | null = null;
let timer: number | undefined;

function hide(): void {
  shown?.removeAttribute('data-tip-on');
  shown = null;
}

document.addEventListener(
  'mousemove',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el !== shown) {
      hide();
      shown = el;
      el?.setAttribute('data-tip-on', '');
    }
    clearTimeout(timer);
    if (el) timer = window.setTimeout(hide, LINGER);
  },
  { passive: true },
);
// A click acts on the button; its explanation has done its job.
document.addEventListener('mousedown', hide, { passive: true });
document.documentElement.addEventListener('mouseleave', hide);
