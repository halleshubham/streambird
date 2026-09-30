/**
 * Three-tier role system (see User.role):
 * - SUPERADMIN: a fixed, small set of operator identities, seeded from env
 *   (SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD) -- never created via signup.
 * - COMPANY_ADMIN: the first user of a company (self-service signup). Gated
 *   behind Superadmin approval (see User.approvedAt) until then -- see
 *   AccountGuard, which enforces this on every route it protects.
 * - USER: added to an existing company by that company's Company Admin (or
 *   a Superadmin). Not subject to the approval gate. Also the default role
 *   for every pre-existing, solo (old-model) account, so old behavior is
 *   unaffected.
 */
export enum Role {
  SUPERADMIN = 'superadmin',
  COMPANY_ADMIN = 'company_admin',
  USER = 'user',
}
