/**
 * Review accounts: emails an operator lists in REVIEW_ACCOUNT_EMAILS (comma separated) are
 * approved the first time they sign in, with no step for an admin, and put on a plan with room to
 * try the product (REVIEW_ACCOUNT_PLAN, default 'pro', with no expiry). It exists so an
 * outside reviewer (for example Google's OAuth verification team) can sign in with a test Google
 * account and use StreamBird straight away.
 *
 * Deliberately narrow: it only ever approves the exact addresses the operator set in the
 * environment, it needs the address to have signed in (so the reviewer proves they own it, with
 * Google, a code or Facebook), it never touches a superadmin, and there is no password or fixed
 * code involved.
 */
export function reviewAccountEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.REVIEW_ACCOUNT_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isReviewAccountEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return reviewAccountEmails(env).has(email.trim().toLowerCase());
}

export function reviewAccountPlanKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.REVIEW_ACCOUNT_PLAN?.trim() || 'pro';
}
