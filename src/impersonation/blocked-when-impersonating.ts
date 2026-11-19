import { SetMetadata } from '@nestjs/common';

/**
 * THE single place that decides what a support (impersonation) session may NOT do, even in "act" mode.
 *
 * How it works: put `@BlockedWhenImpersonating('<category>')` on a route (or a whole controller). AccountGuard
 * reads the marker and answers 403 "Not allowed while acting as a customer: <label>" for every impersonated
 * request that reaches it, in both modes and for any HTTP method (it also covers GET routes with side
 * effects, such as the OAuth "connect" redirects). The admin's own requests are never affected.
 *
 * To change what is blocked: add/rename a category below and move the decorator. To block a new endpoint,
 * add the decorator. `test/e2e/impersonation.e2e-spec.ts` ("safety net") fails the build when a mutating route in
 * a sensitive module (billing, platform connections, go-live, team access, ...) has neither the marker nor an
 * entry in IMPERSONATION_EXEMPT_ROUTES with the reason it is safe.
 */
export const BLOCKED_WHEN_IMPERSONATING_KEY = 'blockedWhenImpersonating';

/** Category -> plain-language label shown to the admin ("Not allowed while acting as a customer: <label>"). */
export const IMPERSONATION_BLOCK_CATEGORIES = {
  billing: 'payments and plan changes',
  credentials: 'password, email, API key or login changes',
  connections: 'connecting or disconnecting channels, and stream keys',
  'go-live': 'going live, starting a stream, or opening the live studio as the host',
  'team-access': 'inviting or removing team members',
  'customer-email': 'sending the customer a verification or deletion code',
} as const;

export type ImpersonationBlockCategory = keyof typeof IMPERSONATION_BLOCK_CATEGORIES;

export const BlockedWhenImpersonating = (category: ImpersonationBlockCategory) =>
  SetMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, category);

export function impersonationBlockMessage(category: string): string {
  const label = (IMPERSONATION_BLOCK_CATEGORIES as Record<string, string>)[category] ?? category;
  return `Not allowed while acting as a customer: ${label}`;
}

export const VIEW_ONLY_MESSAGE = 'View-only support session';

/**
 * Mutating routes in sensitive modules that deliberately carry NO marker, with the reason. Keyed
 * "<METHOD> <controller path>/<route path>" exactly as the safety-net test prints it. Anything not listed here
 * and not marked fails the test.
 */
export const IMPERSONATION_EXEMPT_ROUTES: Record<string, string> = {
  // Public sign-in endpoints / SessionGuard routes: never resolve the impersonated principal (they act on the
  // signed-in admin's own login, or on nobody), so there is nothing to block.
  'POST auth/request-code': 'public sign-in; no principal',
  'POST auth/verify-code': 'public sign-in; no principal',
  'POST auth/signup-company': 'public sign-in; no principal',
  'POST auth/superadmin-login': 'public sign-in; no principal',
  'POST auth/superadmin-verify': 'public sign-in; no principal',
  'POST auth/google/app/redeem': 'public sign-in; no principal',
  'POST auth/google/mobile': 'public sign-in; no principal',
  'POST auth/logout': 'SessionGuard: always the real signed-in admin (ends their support session too)',
  'PATCH auth/me/phone': 'SessionGuard: always the real signed-in person, never the impersonated customer',
  // Public, no account principal.
  'POST accounts/': 'public self-service account creation; no principal',
  'POST billing/webhook': 'Razorpay webhook, authenticated by its signature; no principal',
  // The customer must still type the code that was emailed to THEM, so an admin cannot complete it.
  'DELETE account/': 'needs the emailed code only the customer has (founder decision: leave as is)',
};
