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

/** Room kept between a tip and the edge of the window. */
const EDGE = 8;
let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * A tip is centred over its element; by a window's edge (a button at the end of the right-hand
 * panel) it is slid in, so all of it shows. (Tips set beside their element, as in the toolbar,
 * do not take the slide.)
 */
function keepInside(el: Element): void {
  const tip = getComputedStyle(el, '::after');
  (el as HTMLElement).style.removeProperty('--tip-shift');
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = `${tip.fontWeight} ${tip.fontSize} ${tip.fontFamily}`;
  const width = ctx.measureText(el.getAttribute('data-tip') ?? '').width + parseFloat(tip.paddingLeft) + parseFloat(tip.paddingRight);
  const box = el.getBoundingClientRect();
  const left = box.left + box.width / 2 - width / 2;
  const right = left + width;
  const shift = right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : left < EDGE ? EDGE - left : 0;
  if (shift) (el as HTMLElement).style.setProperty('--tip-shift', `${Math.round(shift)}px`);
}

document.addEventListener(
  'mousemove',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el !== shown) {
      hide();
      shown = el;
      if (el) keepInside(el);
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
