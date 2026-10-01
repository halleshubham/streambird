import { api } from './client';
import type {
  AccountDetail,
  AccountListResponse,
  AccountSummary,
  AnalyticsOverview,
  AuditLogEntry,
  LiveStreamRow,
  PendingApproval,
  UpdateSubscriptionPayload,
  UsageAlert,
  UserSearchResult,
} from '../types/api';

export function listPendingApprovals(): Promise<PendingApproval[]> {
  return api.get('/superadmin/pending-approvals');
}

export function approveUser(userId: string): Promise<{ id: string; approvedAt: string }> {
  return api.post(`/superadmin/users/${userId}/approve`);
}

export function rejectUser(userId: string): Promise<void> {
  return api.post(`/superadmin/users/${userId}/reject`);
}

export function listAuditLog(limit = 50, offset = 0): Promise<AuditLogEntry[]> {
  return api.get(`/superadmin/audit-log?limit=${limit}&offset=${offset}`);
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return api.get('/superadmin/analytics/overview');
}

export function listUsageAlerts(): Promise<UsageAlert[]> {
  return api.get('/superadmin/analytics/usage-alerts');
}

export function listLiveStreams(): Promise<LiveStreamRow[]> {
  return api.get('/superadmin/analytics/live-streams');
}

export function forceEndStream(id: string): Promise<{ id: string; status: string; endedAt: string | null }> {
  return api.post(`/superadmin/streams/${id}/force-end`);
}

export function searchUsers(email: string): Promise<UserSearchResult[]> {
  return api.get(`/superadmin/users?email=${encodeURIComponent(email)}`);
}

export function suspendUser(userId: string): Promise<{ id: string; suspendedAt: string }> {
  return api.post(`/superadmin/users/${userId}/suspend`);
}

export function reactivateUser(userId: string): Promise<{ id: string; suspendedAt: string | null }> {
  return api.post(`/superadmin/users/${userId}/reactivate`);
}

export function listAccounts(limit = 50, offset = 0): Promise<AccountListResponse> {
  return api.get(`/superadmin/accounts?limit=${limit}&offset=${offset}`);
}

export function getAccountDetail(id: string): Promise<AccountDetail> {
  return api.get(`/superadmin/accounts/${id}`);
}

export function updateAccountSubscription(
  id: string,
  payload: UpdateSubscriptionPayload,
): Promise<AccountSummary> {
  return api.patch(`/superadmin/accounts/${id}/subscription`, payload);
}

export function suspendAccount(id: string): Promise<AccountSummary> {
  return api.post(`/superadmin/accounts/${id}/suspend`);
}

export function reactivateAccount(id: string): Promise<AccountSummary> {
  return api.post(`/superadmin/accounts/${id}/reactivate`);
}
