/**
 * Hover tips (`data-tip`) show at once and put themselves away again: a tip is
 * visible only while the pointer has moved over its element within the last
 * few seconds, so it never sits on top of the thing you are looking at.
 *
 * The tip is one element laid over the whole page rather than drawn inside its
 * button, so a scrolling panel or the tab strip cannot cut it off, and it is
 * kept inside the window.
 */
const LINGER = 3000;
/** Gap between a tip and its element, and room kept from the window's edge. */
const GAP = 8;
const EDGE = 8;
let shown: Element | null = null;
let timer: number | undefined;
let tip: HTMLDivElement | null = null;

function hide(): void {
  shown = null;
  tip?.classList.remove('on');
}

/** Above its element, centred; below it in the top bar (and a quick bar near the top); beside it in the toolbar. */
function place(el: Element): void {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    document.body.append(tip);
  }
  tip.textContent = el.getAttribute('data-tip');
  const box = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x: number;
  let y: number;
  if (el.closest('.toolbar')) {
    x = box.right + GAP;
    y = box.top + box.height / 2 - h / 2;
  } else {
    x = box.left + box.width / 2 - w / 2;
    const below = el.closest('.tips-down, .topbar') || box.top - GAP - h < EDGE;
    y = below ? box.bottom + GAP : box.top - GAP - h;
  }
  x = Math.max(EDGE, Math.min(x, window.innerWidth - EDGE - w));
  y = Math.max(EDGE, Math.min(y, window.innerHeight - EDGE - h));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  tip.classList.add('on');
}

document.addEventListener(
  'mousemove',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el !== shown) {
      hide();
      // An open menu already says what its button does.
      if (el && !el.matches('.qb-drop.open > [data-tip]')) {
        shown = el;
        place(el);
      }
    }
    clearTimeout(timer);
    if (shown) timer = window.setTimeout(hide, LINGER);
  },
  { passive: true },
);
// A click acts on the button; its explanation has done its job.
document.addEventListener('mousedown', hide, { passive: true });
// The tip stays where it was put, so it goes when what is under it moves.
document.addEventListener('scroll', hide, { passive: true, capture: true });
document.documentElement.addEventListener('mouseleave', hide);
