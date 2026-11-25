import { useEffect, useRef, useState } from 'react';
import { COMPACT_MARKS, type Activity } from './marks.js';

/** One turn of the working loop, as the animated mark draws it. */
const LOOP_S = 2.4;
/** Work shorter than this never shows as working: the mark would only flicker. */
const SETTLE_MS = 400;

export interface ActivityMarkProps {
  /** Something is running: a cursor's step, or the connection being made. */
  working: boolean;
  /** Something is waiting for the user: an open question. */
  unread: boolean;
}

/**
 * The tau mark as the app's state (the design system's ActivityMark), compact cut for the strip.
 * Working starts only once the work has lasted 400 ms, and stops only when the loop in flight has
 * finished, so a dot is never cut off mid-flight. With reduced motion it stays still: the status
 * glyphs beside it already say what is running.
 */
export function ActivityMark({ working, unread }: ActivityMarkProps): JSX.Element {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const still = useReducedMotion();

  useEffect(() => {
    if (working === shown) return;
    let delay = SETTLE_MS;
    if (!working) {
      const svg = box.current?.querySelector('svg');
      const t = svg?.getCurrentTime?.() ?? 0;
      delay = Math.max(0, (LOOP_S - (t % LOOP_S)) * 1000);
    }
    const timer = setTimeout(() => setShown(working), delay);
    return () => clearTimeout(timer);
  }, [working, shown]);

  const activity: Activity = shown && !still ? (unread ? 'working+unread' : 'working') : unread ? 'unread' : 'idle';
  const label = shown ? (unread ? 'tau: working, a question is waiting' : 'tau: working') : unread ? 'tau: a question is waiting' : 'tau';
  return (
    <span
      ref={box}
      className="tau-mark"
      role="img"
      aria-label={label}
      title={label}
      data-activity={activity}
      dangerouslySetInnerHTML={{ __html: COMPACT_MARKS[activity] }}
    />
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedMotion()?.matches ?? false);
  useEffect(() => {
    const query = reducedMotion();
    if (!query) return;
    const change = (): void => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

function reducedMotion(): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}
