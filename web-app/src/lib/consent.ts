/**
 * Cookie / analytics consent. Google Analytics is the only non-essential thing the site loads, and it is not
 * loaded at all until the visitor says yes (opt-in, as GDPR/ePrivacy require); "Reject" and "no answer yet"
 * both mean it never loads. The choice is kept in localStorage. Login and OAuth cookies and the studio's saved
 * layout are strictly necessary and are not covered by this choice.
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

export function setConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
  if (choice === 'granted') loadAnalytics();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: choice }));
}

/** Called once at start-up: loads analytics only for a visitor who already said yes. */
export function initConsent(): void {
  if (getConsent() === 'granted') loadAnalytics();
}

/** "Cookie settings" links call this to bring the banner back so the choice can be changed. */
export function reopenConsent(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export const CONSENT_EVENTS = { open: OPEN_EVENT, change: CHANGE_EVENT };
