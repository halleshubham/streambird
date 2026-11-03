import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/public.css';
import { Button } from './ui';
import { CONSENT_EVENTS, getConsent, setConsent, useConsentBannerEnabled } from '../lib/consent';

/** The studio and the guest page are working screens: no banner over the controls (no answer = no analytics). */
function isWorkingScreen(path: string): boolean {
  return path.startsWith('/join/') || /\/studio$/.test(path);
}

/**
 * Bottom strip asking whether Google Analytics may be used. Accept and Reject are equally prominent; nothing
 * non-essential loads before an answer (see lib/consent.ts). A "Cookie settings" link in the footers reopens it.
 */
export function CookieBanner() {
  const { pathname } = useLocation();
  const enabled = useConsentBannerEnabled();
  const [open, setOpen] = useState(() => getConsent() === null);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_EVENTS.open, reopen);
    return () => window.removeEventListener(CONSENT_EVENTS.open, reopen);
  }, []);

  if (!enabled || !open || isWorkingScreen(pathname)) return null;

  const choose = (choice: 'granted' | 'denied') => {
    setConsent(choice);
    setOpen(false);
  };

  return (
    <section className="pub-cookie" role="region" aria-label="Cookie consent">
      <p>
        We use essential cookies to keep you signed in. With your OK we also use Google Analytics to see which pages are
        used, so we can improve StreamBird. <Link to="/privacy#cookies">Read how we use cookies</Link>.
      </p>
      <div className="pub-cookie-actions">
        <Button variant="secondary" onClick={() => choose('denied')}>
          Reject
        </Button>
        <Button variant="secondary" onClick={() => choose('granted')}>
          Accept
        </Button>
      </div>
    </section>
  );
}
