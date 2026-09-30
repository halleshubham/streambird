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

export interface PendingCompanyAdmin {
  id: string;
  email: string;
  companyName: string | null;
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
  errorMessage: string | null;
}

export interface Stream {
  id: string;
  title: string;
  status: StreamStatus;
  ingestUrl: string | null;
  streamKey: string | null;
  whipUrl: string | null;
  studioSessionId?: string;
  destinations: Destination[];
}

export interface HostTokenResponse {
  token: string;
}

export interface CreateInviteResponse {
  token: string;
  joinUrl: string;
  expiresAt: string;
}

export interface ResolveInviteResponse {
  studioSessionId: string;
  label: string | null;
  expiresAt: string;
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
