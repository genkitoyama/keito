import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Whether a key press belongs to the IME: still composing, or the Enter that confirms a
 * conversion. WebKit (Safari, and the macOS app's webview) ends the composition before that Enter
 * arrives, so it comes with isComposing false and keyCode 229 — and must not submit anything.
 */
/** Whether a key goes to a control that acts on it (Space and Enter press a focused button). */
export function onControl(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (/^(BUTTON|A|SUMMARY)$/.test(t.tagName) || t.getAttribute('role') === 'button');
}

export function composing(e: ReactKeyboardEvent | KeyboardEvent): boolean {
  const key = 'nativeEvent' in e ? e.nativeEvent : e;
  return key.isComposing || key.keyCode === 229;
}
