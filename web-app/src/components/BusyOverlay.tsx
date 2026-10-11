import { useEffect, useState } from 'react';
import { useBusyCount } from '../lib/busy';

// Shown only after the work has taken a moment, so a click that answers in under ~250ms doesn't flash a bird.
const SHOW_AFTER_MS = 250;
// A safety net: whatever is still "busy" after this long, the big bird stops covering the page (the small one in the
// button or status line stays). Nothing legitimate here takes this long, and a stuck indicator is worse than none.
const HIDE_AFTER_MS = 45_000;

/**
 * A big flapping bird in the middle of the screen while any action is in progress. It never
 * blocks the page (pointer-events: none): the busy button is already disabled, and the studio
 * has to stay usable while it, for example, goes live.
 */
export function BusyOverlay() {
  const busy = useBusyCount() > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      // Reached only from the effect cleanup/timer path, never synchronously mirroring a prop.
      const hide = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hide);
    }
    const show = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    const giveUp = setTimeout(() => setVisible(false), SHOW_AFTER_MS + HIDE_AFTER_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [busy]);

  if (!busy || !visible) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-overlay-card">
        <img src="/logo.png" alt="" className="busy-overlay-bird" />
        <span>Working on it…</span>
      </div>
    </div>
  );
}
