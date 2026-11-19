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
  connections: 'connecting or disconnecting channels, and stream keys',
  'go-live': 'going live, starting a stream, or opening the live studio as the host',
  'live-control': 'ending, retrying or restarting a live stream',
  'team-access': 'inviting or removing team members',
  'customer-email': 'sending the customer a verification or deletion code',
  'guest-email': 'sending guest invitations',
  'guest-link': 'creating guest join links',
  'phone-channel': "the phone app's remote-control channel (only the stream owner's own phone may use it)",
} as const;

export type ImpersonationBlockCategory = keyof typeof IMPERSONATION_BLOCK_CATEGORIES;

export const BlockedWhenImpersonating = (category: ImpersonationBlockCategory) =>
  SetMetadata(BLOCKED_WHEN_IMPERSONATING_KEY, category);

/** Categories whose 403 text is a whole sentence of its own (founder wording) instead of "Not allowed ...: <label>". */
export const START_STOP_MESSAGE = 'Starting and stopping streams is not allowed while acting as a customer';
const FULL_MESSAGES: Record<string, string> = { 'go-live': START_STOP_MESSAGE, 'live-control': START_STOP_MESSAGE };

export function impersonationBlockMessage(category: string): string {
  if (FULL_MESSAGES[category]) return FULL_MESSAGES[category];
  const label = (IMPERSONATION_BLOCK_CATEGORIES as Record<string, string>)[category] ?? category;
  return `Not allowed while acting as a customer: ${label}`;
}

export const VIEW_ONLY_MESSAGE = 'View-only support session';
export const GUEST_EMAIL_MESSAGE = 'Guest invitations cannot be sent while acting as a customer';
/** 409 body code when the client says it is in a support session that no longer exists (see AccountGuard). */
export const SUPPORT_SESSION_ENDED_CODE = 'support_session_ended';
export const SUPPORT_SESSION_HEADER = 'x-support-session';

/**
 * Response fields that are NEVER returned while a support session is in effect (matched by key name, anywhere in
 * the JSON; the value becomes IMPERSONATION_REDACTED_VALUE): publishing credentials (stream key, ingest / WHIP /
 * RTMP urls), guest join links / invite tokens and the invitation text (it embeds the join link). Add a word here to redact a new kind of secret everywhere.
 * (There is deliberately no `credentials` block category: customers have no password / email / API-key routes.)
 */
export const IMPERSONATION_REDACTED_KEY = /stream_?key|ingest|whip|rtmp|publish_?url|join_?url|invite_?token|invitation_?text|host_?token|control_?token|(^|_)token$|^token/i;
export const IMPERSONATION_REDACTED_VALUE = null;

/**
 * Marks THE one handler whose response may carry the support CONTROL token (POST streams/:id/support-control-token):
 * the redaction interceptor then spares the top-level `controlToken` key of that response only. Everywhere else
 * `control_?token` is redacted like any other credential. The token never yields publishing rights (see
 * `src/studio/support/`), but it must not leak into any other payload.
 */
export const RETURNS_SUPPORT_CONTROL_TOKEN_KEY = 'returnsSupportControlToken';
export const ReturnsSupportControlToken = () => SetMetadata(RETURNS_SUPPORT_CONTROL_TOKEN_KEY, true);

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
  'POST studio-sessions/invites/:token/check-password': 'public guest password check; no principal',
  'POST billing/webhook': 'Razorpay webhook, authenticated by its signature; no principal',
  // The customer must still type the code that was emailed to THEM, so an admin cannot complete it.
  'DELETE account/': 'needs the emailed code only the customer has (founder decision: leave as is)',
};

/**
 * ALLOWLIST of every mutating route outside the superadmin controllers that an ACT-mode support session may call
 * (configuration the founder decided support may manage). The safety-net test fails for any non-GET route that is
 * neither marked @BlockedWhenImpersonating, nor in IMPERSONATION_EXEMPT_ROUTES, nor listed here, so a NEW endpoint
 * cannot ship unclassified. Key format: "<METHOD> <controller path>/<route path>".
 */
export const IMPERSONATION_ACT_ALLOWED: Record<string, string> = {
  // Brand library and kits (configuration; files are private image uploads).
  'POST assets': 'brand library: upload a file',
  'PATCH assets/:id': 'brand library: rename a file',
  'DELETE assets/:id': 'brand library: delete a file',
  'POST brand-kits': 'brand kits (logo, wallpaper, ads, clock, default text)',
  'PATCH brand-kits/:id': 'brand kits',
  'DELETE brand-kits/:id': 'brand kits',
  'PUT brand-kits/connections/:connectionId': 'which kit a channel uses (mapping only, no credentials)',
  // Presets (saved setups); starting one is blocked (go-live).
  'POST presets/': 'presets: create',
  'PATCH presets/:id': 'presets: edit',
  'DELETE presets/:id': 'presets: delete',
  'POST presets/:id/use': 'presets: stamps last-used only',
  // Scheduled streams. Guest emails are refused inside StreamSchedulingService (GUEST_EMAIL_MESSAGE) when a
  // guest would be emailed: create with guestEmails, update without notifyGuests:false, cancel with guests.
  'POST streams/schedule': 'schedule a stream (no guest emails: checked in the service)',
  'PATCH streams/:id/schedule': 'edit a schedule (guest emails: checked in the service)',
  'DELETE streams/:id/schedule': 'discard a scheduled stream (silent)',
  'POST streams/:id/schedule/cancel': 'cancel a schedule (refused in the service when guests would be emailed)',
  'DELETE streams/:id/schedule/guests/:inviteId': 'remove a guest link (silent)',
  'PUT streams/:id/schedule/thumbnail': 'per-stream thumbnail',
  'DELETE streams/:id/schedule/thumbnail': 'per-stream thumbnail',
  'PUT streams/:id/thumbnail': 'per-stream thumbnail',
  'DELETE streams/:id/thumbnail': 'per-stream thumbnail',
  // Studio session settings (no credentials; join links are blocked / redacted).
  'DELETE studio-sessions/:id/invites/:inviteId': 'revoke a guest link',
  'PATCH studio-sessions/:id/layout': 'studio layout setting',
  // Remote control of a LIVE studio (act mode only, checked in the service; never yields publishing rights: the
  // gateway only relays a whitelist of picture-composition commands to the host). `host-token` stays blocked.
  'POST streams/:id/support-control-token': 'live studio remote control: mints a short-lived support socket token (act mode, live stream of the customer)',
};
