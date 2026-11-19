import type { ImpersonationInfo } from '../types/api';

/** "mm:ss" for the support-session countdown; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Who the admin is acting as, for the banner: the company (or account) name, else the person's name, else the email. */
export function impersonationTargetName(info: ImpersonationInfo): string {
  return info.target.companyName || info.target.accountName || info.target.displayName || info.target.email;
}

export const IMPERSONATION_MODE_LABEL = { view: 'View-only', act: 'Can edit' } as const;

/** What stays blocked even in "Can edit" mode: shown in the confirm dialog. Mirrors src/impersonation/blocked-when-impersonating.ts (the server is the authority). */
export const SUPPORT_BLOCKED_SUMMARY = [
  'Payments and plan changes',
  'Password, email, API key or login changes',
  'Connecting or disconnecting channels, and stream keys',
  'Starting or stopping streams, or opening the live studio as the host',
  'Live studio controls (layout, ads, ticker, lower thirds, clock) cannot be changed remotely yet',
  'Inviting or removing team members',
];
