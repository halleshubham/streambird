/** Pure helpers for the UI kit (no React, no DOM), unit-tested in test/ui/ui-kit-helpers.spec.ts. */

/** Join class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Where focus goes when Tab / Shift+Tab is pressed inside a focus trap of `count` focusable elements. */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0; // focus is outside the trap: pull it in
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

/** Typed confirmation: the phrase must match what was asked for, ignoring surrounding spaces and letter case. */
export function typedConfirmationMatches(typed: string, expected: string): boolean {
  const want = expected.trim().toLowerCase();
  return want.length > 0 && typed.trim().toLowerCase() === want;
}

export type ToastKind = 'success' | 'error' | 'info';

/** How long a toast stays: errors and toasts with an action (Undo, Retry) stay longer so they can be used. */
export function toastDurationMs(kind: ToastKind, hasAction: boolean): number {
  if (hasAction) return 10_000;
  return kind === 'error' ? 8_000 : 4_000;
}

/** The two-letter avatar for the phone account button ("maya.k@acme.example" -> "MK"). */
export function initialsFor(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? '';
  const parts = local.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Selector for elements a focus trap may land on. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
