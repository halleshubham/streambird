import { useEffect, useState } from 'react';
import { useBusyCount } from '../lib/busy';

// Shown only after the work has taken a moment, so a click that answers in under ~250ms doesn't flash a bird.
const SHOW_AFTER_MS = 250;

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
    return () => clearTimeout(show);
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
