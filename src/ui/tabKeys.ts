import { boardLoading, useStore } from '../model/store';
import { boardBeside } from './BoardTabs';
import { composing, isCatcher, isField, overBoard } from './keys';

/**
 * ⌘⇧] and ⌘⇧[ (Ctrl+Shift on Windows), the keys other apps use for the next and the previous tab:
 * 1, −1, or 0 for any other key. Matched by e.key, not e.code: the keys sit elsewhere on a Japanese
 * keyboard, and with ⌘ held the character may come shifted ({ }) or not.
 */
function tabStep(e: KeyboardEvent): -1 | 0 | 1 {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return 0;
  if (e.key === '[' || e.key === '{') return -1;
  if (e.key === ']' || e.key === '}') return 1;
  return 0;
}

/**
 * The tab a press goes to: counted from the board still loading, if any, so that presses quicker
 * than a load (a key held down) each go one tab further; otherwise from the board on screen.
 */
export function nextTab(step: 1 | -1): string | undefined {
  const { doc, boards } = useStore.getState();
  return boardBeside(doc, boards, step, boardLoading());
}

/** Whether a mouse button, a finger or a pen is down: a drag of any kind may be under way. */
let pressed = false;

function onTabKey(e: KeyboardEvent): void {
  const step = tabStep(e);
  if (!step) return;
  // Ignored during IME conversion (on the hidden IME field of a selected shape, keyCode 229 alone
  // tells it, as in App), during a drag, and under a dialog or the project menu.
  const ime = isCatcher(e.target) ? e.keyCode === 229 : composing(e);
  if (ime || pressed || overBoard()) return;
  e.preventDefault();
  e.stopPropagation();
  let to = nextTab(step);
  if (!to) return;
  // As a click on a tab does, blur the focused field first: its edit is committed, and a project
  // name just typed there changes the tabs, so the target is computed again.
  const field = document.activeElement;
  if (isField(field)) {
    field.blur();
    to = nextTab(step);
  }
  if (to) useStore.getState().openBoard(to);
}

/**
 * ⌘⇧] / ⌘⇧[ in the desktop app (in a browser, these keys switch the browser's own tabs). Listened
 * to in the capture phase: the board's text editor stops key events from bubbling.
 */
export function listenTabKeys(): void {
  const track = (e: PointerEvent) => void (pressed = e.buttons !== 0);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) window.addEventListener(type, track, true);
  window.addEventListener('blur', () => void (pressed = false));
  window.addEventListener('keydown', onTabKey, true);
}
