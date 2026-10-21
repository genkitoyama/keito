import { useRef } from 'react';
import { useStore } from '../model/store';

/** How long a pause ends a burst of changes (ms). */
const PAUSE = 800;

/**
 * One undo step for a burst of changes from one control: a slider dragged, a colour picker
 * dragged round, a name typed. Call the returned function before each change and make the change
 * without recording it: the first of a burst keeps the board as it was.
 */
export function useBurst(): () => void {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current > PAUSE) useStore.getState().checkpoint();
    last.current = now;
  };
}
