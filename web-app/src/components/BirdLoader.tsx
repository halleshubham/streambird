import { useEffect, useRef, useState } from 'react';

const EXIT_DURATION_MS = 600;

type Phase = 'flying' | 'exiting' | 'done';

/**
 * Branded loading indicator: the StreamBird logo flaps in place while
 * `loading` is true, then flies off-screen the instant it flips to false --
 * meant to replace a bare "Loading…"/flicker with something that reads as
 * "the bird went to go get it" rather than a broken render. Stays mounted
 * (rendering null once its exit animation finishes) so the fly-out can
 * actually play rather than the whole subtree vanishing the instant the
 * parent's condition changes.
 */
export function BirdLoader({ loading, label, compact = false }: { loading: boolean; label?: string; compact?: boolean }) {
  // 'flying' vs 'exiting' is derived straight from the `loading` prop
  // during render -- no state needed for that. `exited` is the one thing
  // that's genuinely stateful (it depends on history: has the exit timer
  // fired yet), set only from inside the timer's own callback -- never
  // synchronously in the effect body itself -- so this is an effect purely
  // synchronizing with an external system (the timer), the case React's
  // own docs carve out for useEffect+setState, not a synchronous mirror of
  // a prop. `hidden` then combines it with `loading` at render time so a
  // loader shown again later doesn't need `exited` reset by anything.
  const [exited, setExited] = useState(false);
  const wasLoadingRef = useRef(loading);

  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = loading;
    if (loading || !wasLoading) return;
    const timer = setTimeout(() => setExited(true), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  if (exited && !loading) return null;
  const phase: Phase = loading ? 'flying' : 'exiting';

  return (
    <div className={`bird-loader${compact ? ' bird-loader--compact' : ''}`}>
      <img src="/logo.png" alt="" className={`bird-loader-bird bird-loader-bird--${phase}`} />
      {label && phase === 'flying' && <p className="bird-loader-label">{label}</p>}
    </div>
  );
}
