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
  description: string | null;
  scheduledAt: string | null;
  isScheduledEvent: boolean;
  timezone: string | null;
  expectedDurationMinutes: number | null;
  cancelledAt: string | null;
  destinations: Destination[];
}

export interface ScheduleGuest {
  id: string;
  email: string;
  joinUrl: string;
  emailedAt: string | null;
}

/** GET/PATCH/POST /streams/:id/schedule -- see StreamSchedulingService.buildDetail server-side. */
export interface ScheduleDetail {
  id: string;
  title: string;
  description: string | null;
  visibility: 'public' | 'unlisted' | 'private' | null;
  status: StreamStatus;
  scheduledAt: string;
  timezone: string;
  durationMinutes: number | null;
  guestNotes: string | null;
  studioSessionId: string;
  passwordProtected: boolean;
  /** Platform broadcasts (YouTube, Facebook) are created now rather than at start. */
  precreateOnPlatforms: boolean;
  hasThumbnail: boolean;
  /** Changes when the thumbnail is replaced -- use as a cache-busting query param. */
  thumbnailUpdatedAt: string | null;
  destinations: Array<{
    id: string;
    platformConnectionId: string;
    platform: Platform;
    label: string;
    /** This platform can hold a scheduled broadcast ahead of time. */
    canPrecreate: boolean;
    /** The broadcast already exists on the platform. */
    onPlatform: boolean;
    watchUrl: string | null;
    errorMessage: string | null;
  }>;
  guests: ScheduleGuest[];
  generalJoinUrl: string | null;
  invitationText: string;
  /** Set on responses that sent email: addresses that could not be reached. */
  emailFailures?: string[];
  /** What couldn't be created/updated/removed on the platforms by this call. */
  platformWarnings?: string[];
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
  cancelledAt: string | null;
  isScheduledEvent: boolean;
  /** Upcoming view only. */
  guestCount?: number;
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
  planKey: string;
  includedHoursOverride: string | null;
  maxDestinationsOverride: number | null;
  maxGuestsOverride: number | null;
  dayPassPlanKey: string | null;
  dayPassExpiresAt: string | null;
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
  planKey?: string;
  /** null clears the override (back to the plan's value). */
  includedHoursOverride?: number | null;
  maxDestinationsOverride?: number | null;
  maxGuestsOverride?: number | null;
}

export type Resolution = 'sd' | 'hd' | 'fhd';

/** A plan as the public pricing page sees it (GET /plans/public). */
export interface PublicPlan {
  key: string;
  name: string;
  kind: 'monthly' | 'day_pass';
  /** null = unlimited. */
  includedHoursPerMonth: number | null;
  maxDestinations: number;
  maxGuests: number;
  maxResolution: Resolution;
  maxSessionHours: number | null;
  validityHours: number | null;
  priceInr: number | null;
  priceUsd: number | null;
}

/** Everything a plan row holds, for the superadmin editor (GET /superadmin/plans). numerics arrive as strings. */
export interface AdminPlan {
  key: string;
  name: string;
  kind: 'monthly' | 'day_pass';
  includedHoursPerMonth: string | null;
  graceMultiplier: string;
  maxDestinations: number;
  maxGuests: number;
  maxResolution: Resolution;
  maxSessionHours: string | null;
  validityHours: number | null;
  priceInr: number | null;
  priceUsd: string | null;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** Body for POST/PATCH /superadmin/plans -- numbers, with null meaning unlimited/none. */
export interface PlanPayload {
  key?: string;
  name?: string;
  kind?: 'monthly' | 'day_pass';
  includedHoursPerMonth?: number | null;
  graceMultiplier?: number;
  maxDestinations?: number;
  maxGuests?: number;
  maxResolution?: Resolution;
  maxSessionHours?: number | null;
  validityHours?: number | null;
  priceInr?: number | null;
  priceUsd?: number | null;
  isPublic?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

/** What the signed-in account may do right now (GET /plans/me): plan + overrides + any active day pass. */
export interface EffectiveLimits {
  planKey: string;
  planName: string;
  includedHours: number | null;
  graceMultiplier: number;
  maxDestinations: number;
  maxGuests: number;
  maxResolution: Resolution;
  maxSessionHours: number | null;
  dayPass: { planKey: string; name: string; expiresAt: string } | null;
}
