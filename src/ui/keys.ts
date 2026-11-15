import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Whether a key goes to a control that acts on it (Space and Enter press a focused button) — one
 * reached from the keyboard. A button clicked with the mouse keeps the focus in Chrome (not in
 * WebKit): Space then pans and Enter edits, as anywhere on the board, rather than press it again.
 */
export function onControl(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement && (/^(BUTTON|A|SUMMARY)$/.test(t.tagName) || t.getAttribute('role') === 'button'))) return false;
  try {
    return t.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** The hidden field that takes the IME's typing on a selected shape (Windows; see Canvas's ImeCatcher). */
export const isCatcher = (t: EventTarget | null): boolean => t instanceof HTMLElement && t.classList.contains('ime-catcher');

/** A window (export, the boards list …) or the project menu over the board. */
export const overBoard = (): boolean => !!document.querySelector('.modal-bg, .project-menu');

/** Whether keys go to a text field (the hidden field of the IME on a selected shape is the board's, not one). */
export const isField = (t: EventTarget | null): t is HTMLElement =>
  t instanceof HTMLElement && !isCatcher(t) && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Whether a key press belongs to the IME: still composing, or the Enter that confirms a
 * conversion. WebKit (Safari, and the macOS app's webview) ends the composition before that Enter
 * arrives, so it comes with isComposing false and keyCode 229 — and must not submit anything.
 */
export function composing(e: ReactKeyboardEvent | KeyboardEvent): boolean {
  const key = 'nativeEvent' in e ? e.nativeEvent : e;
  return key.isComposing || key.keyCode === 229;
}
