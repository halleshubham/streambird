import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { endImpersonation } from '../api/superadmin';
import { ApiError } from '../api/client';
import { toast } from './ui';
import { BirdBusy } from './BirdBusy';
import { IMPERSONATION_MODE_LABEL, formatCountdown, impersonationTargetName } from '../lib/impersonation';
import type { ImpersonationInfo } from '../types/api';
import './ui/support.css';

const POLL_MS = 30_000;

/**
 * The persistent, non-dismissable "Support session" bar. Mounted once in App, so it is on EVERY page while a
 * superadmin support session is active (dashboard, brand, studio, ...). It also owns the session's end: Exit,
 * expiry and "ended in another tab" all land here as `impersonation` turning null, and the app then returns to
 * the admin area with a toast. The server is the authority; this only shows and navigates.
 */
export function ImpersonationBanner() {
  const { impersonation, status, refresh } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<ImpersonationInfo | null>(null);
  const exitingRef = useRef(false);
  const lastRefreshRef = useRef(0);

  // The session ended (Exit, expired, ended elsewhere): back to the admin area for that customer.
  useEffect(() => {
    if (impersonation) {
      lastRef.current = impersonation;
      return;
    }
    const last = lastRef.current;
    if (last && status === 'authenticated') {
      lastRef.current = null;
      toast.info(exitingRef.current ? 'Support session ended.' : 'The support session has ended. You are back in your own account.');
      exitingRef.current = false;
      navigate(`/admin/accounts/${last.target.accountId}`, { replace: true });
    }
  }, [impersonation, status, navigate]);

  // Countdown tick and a slow poll, so a session ended in another tab is noticed.
  useEffect(() => {
    if (!impersonation) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => void refresh(), POLL_MS);
    // Coming back to this tab: ask right away (it may have ended or been replaced meanwhile).
    const onBack = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [impersonation, refresh]);

  // Time is up: ask the server (it ends the session and /auth/me then answers as the admin).
  const remaining = impersonation ? new Date(impersonation.expiresAt).getTime() - now : 1;
  useEffect(() => {
    if (impersonation && remaining <= 0 && Date.now() - lastRefreshRef.current > 3000) {
      lastRefreshRef.current = Date.now();
      void refresh();
    }
  }, [impersonation, remaining, refresh]);

  // Give the page the banner's height (it is fixed, so the page is pushed down by body padding, see support.css).
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!impersonation || !el) return;
    const apply = () => document.documentElement.style.setProperty('--imp-h', `${el.offsetHeight}px`);
    apply();
    document.body.dataset.impersonating = '1';
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      delete document.body.dataset.impersonating;
      document.documentElement.style.removeProperty('--imp-h');
    };
  }, [impersonation]);

  if (!impersonation) return null;

  async function exit() {
    setBusy(true);
    exitingRef.current = true;
    try {
      await endImpersonation();
      await refresh();
    } catch (err) {
      exitingRef.current = false;
      toast.error(err instanceof ApiError ? err.message : 'Could not end the support session. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const { target, mode } = impersonation;
  const name = impersonationTargetName(impersonation);
  return (
    <div ref={barRef} className="support-banner" role="status" data-testid="impersonation-banner" data-mode={mode}>
      <ShieldAlert size={20} className="support-banner-icon" aria-hidden="true" />
      <span className="support-banner-text">
        <strong>Support session:</strong> acting as {name} ({target.email}) · <strong data-testid="impersonation-mode">{IMPERSONATION_MODE_LABEL[mode]}</strong> · expires in{' '}
        <span className="support-banner-time" aria-live="off" data-testid="impersonation-countdown">
          {formatCountdown(remaining)}
        </span>
      </span>
      <button type="button" className="support-banner-exit" data-testid="impersonation-exit" aria-label="Exit support session" disabled={busy} onClick={() => void exit()}>
        {busy && <BirdBusy overlay={false} />}
        Exit
      </button>
    </div>
  );
}
