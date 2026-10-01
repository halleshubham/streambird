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
  const [phase, setPhase] = useState<Phase>(loading ? 'flying' : 'done');
  const wasLoadingRef = useRef(loading);

  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = loading;
    if (loading) {
      setPhase('flying');
      return;
    }
    if (wasLoading) {
      setPhase('exiting');
      const timer = setTimeout(() => setPhase('done'), EXIT_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  if (phase === 'done') return null;

  return (
    <div className={`bird-loader${compact ? ' bird-loader--compact' : ''}`}>
      <img src="/logo.png" alt="" className={`bird-loader-bird bird-loader-bird--${phase}`} />
      {label && phase === 'flying' && <p className="bird-loader-label">{label}</p>}
    </div>
  );
}
