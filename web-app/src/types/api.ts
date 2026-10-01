// Hand-kept to match the backend's response DTOs exactly (see
// streambird/src/**/dto/*.ts). OpenAPI codegen is deferred -- the surface
// is still small enough that keeping these in sync by hand is cheap.

export type Platform = 'youtube' | 'facebook' | 'twitch' | 'linkedin';
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';
export type StreamStatus = 'scheduled' | 'live' | 'ended' | 'failed';
export type DestinationStatus = 'pending' | 'ready' | 'live' | 'ended' | 'failed';

export type UserRole = 'superadmin' | 'company_admin' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  approvedAt: string | null;
  createdAt?: string;
}

export interface MeResponse {
  user: AuthUser;
  accountId: string;
}

export interface TeamMember {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface PendingApproval {
  id: string;
  email: string;
  role: UserRole;
  companyName: string | null;
  createdAt: string;
}

export interface UserSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  accountId: string;
  companyName: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  currentTier: PlanTier;
  includedHoursPerMonth: string;
  streamHourUsageCurrentPeriod: string;
  billingPeriodStart: string | null;
}

export interface AccountUsageRanking {
  accountId: string;
  accountName: string;
  currentTier: PlanTier;
  streamHourUsageCurrentPeriod: string;
  includedHoursPerMonth: string;
}

export interface AnalyticsOverview {
  streamsToday: number;
  streamsThisWeek: number;
  currentlyLive: number;
  /** Fraction 0-1 (not a percentage) of recent LiveStreamDestination rows
   * that ended up failed -- see SuperadminAnalyticsService server-side. */
  destinationFailureRate: number;
  topAccountsByUsage: AccountUsageRanking[];
}

export type UsageAlertBucket = 'near_limit' | 'over_limit';

export interface UsageAlert extends AccountUsageRanking {
  bucket: UsageAlertBucket;
  ratio: number;
}

export interface LiveStreamRow {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  startedAt: string | null;
}

export interface PlatformConnection {
  id: string;
  platform: Platform;
  externalAccountId: string;
  label: string;
  isActive: boolean;
}

export interface Destination {
  id: string;
  platformConnectionId: string;
  status: DestinationStatus;
  viewerCount: number | null;
  watchUrl: string | null;
  errorMessage: string | null;
}

export interface Stream {
  id: string;
  title: string;
  status: StreamStatus;
  ingestUrl: string | null;
  streamKey: string | null;
  whipUrl: string | null;
  visibility: 'public' | 'unlisted' | 'private' | null;
  studioSessionId?: string;
  destinations: Destination[];
}

/** GET /streams/:id/status's shape -- distinct from Stream/Destination above (which come from the plain create/get endpoints) because this one additionally carries each destination's real, freshly-polled platform status. */
export interface StreamStatusDestination {
  id: string;
  platformConnectionId: string;
  status: DestinationStatus;
  /** The platform's OWN reported lifecycle status (e.g. YouTube's created/ready/testing/live/complete), when the provider supports reading it -- null otherwise. See StreamsService.getStatus server-side for why this can genuinely differ from `status` above. */
  platformStatus: string | null;
  viewerCount: number | null;
  watchUrl: string | null;
  errorMessage: string | null;
}

export interface StreamStatusResponse {
  status: StreamStatus;
  relayInputStatus: 'idle' | 'connected' | null;
  destinations: StreamStatusDestination[];
}

export interface HostTokenResponse {
  token: string;
}

export interface CreateInviteResponse {
  token: string;
  joinUrl: string;
  // null means "valid until the host ends the stream" -- the only behavior
  // going forward; invites no longer carry a fixed TTL.
  expiresAt: string | null;
}

export interface ResolveInviteResponse {
  studioSessionId: string;
  label: string | null;
  expiresAt: string | null;
  passwordRequired: boolean;
}

export interface DestinationSummary {
  platform: Platform;
  status: DestinationStatus;
}

export interface StreamListItem {
  id: string;
  title: string;
  status: StreamStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  destinationsSummary: DestinationSummary[];
}

export interface StreamListResponse {
  items: StreamListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Row shape for GET /superadmin/accounts -- see SuperadminAccountsService.list. */
export interface AccountSummary {
  id: string;
  name: string;
  currentTier: PlanTier;
  includedHoursPerMonth: string;
  streamHourUsageCurrentPeriod: string;
  billingPeriodStart: string | null;
  suspendedAt: string | null;
  createdAt: string;
  companyName: string | null;
  userCount: number;
}

export interface AccountListResponse {
  items: AccountSummary[];
  total: number;
}

export interface AccountUser {
  id: string;
  email: string;
  role: UserRole;
  approvedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface AccountStreamHistoryItem {
  id: string;
  title: string;
  status: StreamStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AccountPlatformConnection {
  id: string;
  platform: Platform;
  label: string;
  isActive: boolean;
}

/** Full payload for GET /superadmin/accounts/:id -- see SuperadminAccountsService.getDetail. */
export interface AccountDetail extends AccountSummary {
  users: AccountUser[];
  streams: AccountStreamHistoryItem[];
  platformConnections: AccountPlatformConnection[];
}

/** Body for PATCH /superadmin/accounts/:id/subscription -- all fields optional. */
export interface UpdateSubscriptionPayload {
  currentTier?: PlanTier;
  includedHoursPerMonth?: string;
  billingPeriodStart?: string | null;
}
