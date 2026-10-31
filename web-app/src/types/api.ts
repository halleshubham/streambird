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
  /** Mobile number (E.164), or null when not given. */
  phone?: string | null;
  /** True until a person who must give a mobile number has done so. */
  needsPhone?: boolean;
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
  phone: string | null;
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
  /** Permanent public live link (YouTube/Facebook only; null for Twitch). */
  liveSlug: string | null;
  liveLinkUrl: string | null;
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
  /** 'landscape' (16:9) or 'portrait' (9:16 vertical): the shape of the studio canvas, fixed at creation. */
  orientation: 'landscape' | 'portrait';
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
  orientation: 'landscape' | 'portrait';
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
  /** On a search: a user on this account whose email matched (the account's own name did not). */
  matchedUserEmail?: string | null;
}

export interface AccountListResponse {
  items: AccountSummary[];
  total: number;
}

export interface AccountUser {
  id: string;
  email: string;
  phone: string | null;
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

export type Resolution = 'sd' | 'hd' | 'fhd' | 'qhd';

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
  canRecord: boolean;
  canChromaKey: boolean;
  canLowerThird: boolean;
  assetStorageMb: number;
  watermark: boolean;
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
  canRecord: boolean;
  canChromaKey: boolean;
  canLowerThird: boolean;
  assetStorageMb: number;
  watermark: boolean;
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
  canRecord?: boolean;
  canChromaKey?: boolean;
  canLowerThird?: boolean;
  assetStorageMb?: number;
  watermark?: boolean;
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
  canRecord: boolean;
  canChromaKey: boolean;
  canLowerThird: boolean;
  assetStorageMb: number;
  watermark: boolean;
  maxSessionHours: number | null;
  dayPass: { planKey: string; name: string; expiresAt: string } | null;
  /** When a purchased plan lapses (null = no expiry). */
  planExpiresAt: string | null;
  /** The plan has lapsed, so these are Free limits. */
  planExpired: boolean;
}

export interface BillingConfig {
  enabled: boolean;
  /** Razorpay's public key id; null while payments are off. */
  keyId: string | null;
}

export interface CheckoutOrder {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  planKey: string;
  planName: string;
  description: string;
}

export interface SubscriptionCheckout {
  subscriptionId: string;
  keyId: string;
  planKey: string;
  planName: string;
  amountPaise: number;
  description: string;
}

/** The account's autopay (GET /billing/subscription); null when it has none. */
export interface MySubscription {
  planKey: string;
  status: 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled';
  amountInr: number;
  cancelAtCycleEnd: boolean;
  /** Next renewal, or the end of the paid cycle if cancelled. */
  currentEnd: string | null;
}

export interface AdminSubscription {
  id: string;
  accountName: string | null;
  planKey: string;
  amountInr: number;
  status: string;
  cancelAtCycleEnd: boolean;
  currentEnd: string | null;
  paidCount: number;
}

export interface MyPayment {
  id: string;
  planKey: string;
  kind: 'plan' | 'day_pass';
  amountInr: number;
  status: 'created' | 'paid' | 'failed';
  paidAt: string | null;
  createdAt: string;
}

export interface AdminPayment {
  id: string;
  accountId: string;
  accountName: string | null;
  planKey: string;
  kind: 'plan' | 'day_pass';
  amountInr: number;
  status: 'created' | 'paid' | 'failed';
  razorpayPaymentId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminBilling {
  enabled: boolean;
  keysConfigured: boolean;
  webhookSecretConfigured: boolean;
  mode: 'live' | 'test' | null;
  webhookUrl: string;
  webhookEvents: string[];
  subscriptions: AdminSubscription[];
  payments: AdminPayment[];
}

export type AssetKind = 'logo' | 'wallpaper' | 'background' | 'other' | 'ad';

export interface LibraryAsset {
  id: string;
  kind: AssetKind;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  /** Names of the brand kits using this file (a used file cannot be deleted). */
  usedBy: string[];
}

export interface AssetLibrary {
  /** Storage is configured on this server. */
  enabled: boolean;
  /** The plan's allowance in bytes; 0 = this plan keeps assets in the browser only. */
  quotaBytes: number;
  usedBytes: number;
  items: LibraryAsset[];
}

export type LowerThirdStyleId = 'bar' | 'accent' | 'glass';

export type AdPlacementId = 'lower_third' | 'side_third' | 'full_screen';

/** One advertisement of a brand kit (one per placement). Continuous ads carry null schedule numbers; times are in seconds. */
export interface BrandKitAd {
  placement: AdPlacementId;
  assetId: string;
  enabled: boolean;
  mode: 'continuous' | 'interval';
  showSec: number | null;
  everySec: number | null;
}

export interface BrandKit {
  id: string;
  name: string;
  logoAssetId: string | null;
  logoPosition: 'left' | 'right';
  logoSize: number;
  wallpaperAssetId: string | null;
  wallpaperDim: number;
  lowerThirdStyle: LowerThirdStyleId;
  isDefault: boolean;
  /** The channels/pages (platform connections) using this kit. */
  connectionIds: string[];
  /** At most one ad per placement. */
  ads: BrandKitAd[];
}

export type BrandKitInput = Pick<BrandKit, 'name' | 'logoAssetId' | 'logoPosition' | 'logoSize' | 'wallpaperAssetId' | 'wallpaperDim' | 'lowerThirdStyle'> & { isDefault?: boolean; ads?: BrandKitAd[] };

/** The superadmin's registration switch and the signup history it is decided by. */
export interface RegistrationStatus {
  /** true = new signups are approved immediately; false = they queue for approval ("paused"). */
  autoApprove: boolean;
  last24h: number;
  last7d: number;
  waiting: number;
}

/** One row of the superadmin "Heavy usage this month" watch. */
export interface HeavyUsageRow {
  accountId: string;
  accountName: string;
  ownerEmail: string | null;
  planKey: string;
  planName: string;
  hoursUsed: number;
  /** null = unlimited plan. */
  includedHours: number | null;
  percentUsed: number | null;
  destinationHours: number;
  estimatedBandwidthCostInr: number;
}
