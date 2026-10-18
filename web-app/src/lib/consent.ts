import { useSyncExternalStore } from 'react';

/**
 * Google Analytics and the optional cookie-consent banner. The server decides which mode the site runs in
 * (COOKIE_CONSENT_BANNER, served by GET /api/config/public; default off):
 *  - off: no banner, and analytics loads for every visitor;
 *  - on: opt-in. Analytics is not loaded at all until the visitor presses Accept; Reject and "no answer yet"
 *    both mean it never loads. The choice is kept in localStorage.
 * If the setting cannot be fetched, nothing is loaded and no banner is shown. Login and OAuth cookies and the
 * studio's saved layout are strictly necessary and are not covered by this.
 */
export type ConsentChoice = 'granted' | 'denied';

const KEY = 'streambird:consent:v1';
const OPEN_EVENT = 'streambird:consent-open';
const CHANGE_EVENT = 'streambird:consent-change';
export const GA_MEASUREMENT_ID = 'G-H2RP3TZ48X';

export function getConsent(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

let analyticsLoaded = false;

/** Adds the Google tag once. Safe to call repeatedly. */
export function loadAnalytics(): void {
  if (analyticsLoaded || typeof document === 'undefined') return;
  analyticsLoaded = true;
  const w = window as unknown as { dataLayer: unknown[]; gtag?: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

/** null until the server's setting is known (or if it could not be fetched). */
let bannerEnabled: boolean | null = null;

export function setConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
  if (choice === 'granted') loadAnalytics();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: choice }));
}

/** Called once at start-up: reads the server setting, then loads analytics if the mode and choice allow it. */
export async function initConsent(): Promise<void> {
  try {
    const res = await fetch('/api/config/public');
    if (!res.ok) return;
    const cfg = (await res.json()) as { cookieConsentBanner?: boolean };
    bannerEnabled = !!cfg.cookieConsentBanner;
  } catch {
    return;
  }
  if (!bannerEnabled || getConsent() === 'granted') loadAnalytics();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

/** True only when the server runs the opt-in banner mode. */
export function useConsentBannerEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => bannerEnabled === true);
}

/** "Cookie settings" links call this to bring the banner back so the choice can be changed. */
export function reopenConsent(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export const CONSENT_EVENTS = { open: OPEN_EVENT, change: CHANGE_EVENT };
