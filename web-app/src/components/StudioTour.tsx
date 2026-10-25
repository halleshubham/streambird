import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const TOUR_KEY = 'streambird:tour:studio:v1';

/** Has this browser already seen (or skipped) the studio tour? Storage can be blocked; then it is simply offered each time. */
export function studioTourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markStudioTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch {
    // best-effort
  }
}

interface Step {
  /** Value of the element's data-tour attribute; none = a centred welcome card. */
  target?: string;
  title: string;
  body: string;
}

function stepsFor(platforms: string): Step[] {
  return [
    {
      title: 'Welcome to your studio',
      body: `This is a private preview of your stream. Nothing reaches ${platforms} until you press Go live. Here is a 30-second tour.`,
    },
    { target: 'camera', title: 'Turn on your camera', body: 'Allow your camera and microphone so you can see and hear yourself in the preview.' },
    { target: 'invite', title: 'Bring a guest (optional)', body: 'Copy a link and send it to a guest. They join from their browser, no app needed.' },
    {
      target: 'golive',
      title: 'Press Go live to start',
      body: `This is the button that actually starts your stream on ${platforms}. It can take 5–10 seconds to show up there.`,
    },
  ];
}

const POPOVER_W = 340;

/**
 * A minimal first-run tour of the host studio: four steps that end on the Go live button, because the most
 * common first-time confusion is not realising the stream only starts when you press it. Skippable (Esc or
 * "Skip tour"), shown once per browser, and replayable from the "preview" banner.
 */
export function StudioTour({ open, platforms, onClose }: { open: boolean; platforms: string; onClose: () => void }) {
  const steps = stepsFor(platforms);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];

  // Start from the first step each time it opens.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (open) setIndex(0);
  }, [open]);

  // Follow the highlighted element (it can move on resize, scroll or a layout change).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step.target]);

  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, onClose]);

  if (!open) return null;

  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  let popover: CSSProperties;
  if (!rect || narrow) {
    popover = rect || narrow ? { left: 12, right: 12, bottom: 12, width: 'auto' } : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: POPOVER_W };
  } else {
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - POPOVER_W - 12);
    popover = { left, top: rect.bottom + 14, width: POPOVER_W };
  }
  const last = index === steps.length - 1;

  return (
    <div className="studio-tour" data-testid="studio-tour">
      <div className="studio-tour-blocker" />
      {rect && (
        <div
          className="studio-tour-spot"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
          aria-hidden="true"
        />
      )}
      {!rect && <div className="studio-tour-dim" aria-hidden="true" />}
      <div className="studio-tour-card" role="dialog" aria-modal="true" aria-label="Studio tour" style={popover}>
        <p className="studio-tour-count">{index + 1} of {steps.length}</p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="studio-tour-actions">
          <button type="button" className="link-button link-button--inline" onClick={onClose}>
            Skip tour
          </button>
          <span className="studio-tour-spacer" />
          {index > 0 && (
            <button type="button" className="icon-btn icon-btn--small" onClick={() => setIndex((i) => i - 1)}>
              Back
            </button>
          )}
          <button ref={nextRef} type="button" className="icon-btn icon-btn--small icon-btn--accent" onClick={() => (last ? onClose() : setIndex((i) => i + 1))}>
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
