import { api } from './client';
import type {
  AnalyticsOverview,
  AuditLogEntry,
  PendingCompanyAdmin,
  UsageAlert,
  UserSearchResult,
} from '../types/api';

export function listPendingCompanyAdmins(): Promise<PendingCompanyAdmin[]> {
  return api.get('/superadmin/pending-company-admins');
}

export function approveCompanyAdmin(userId: string): Promise<{ id: string; approvedAt: string }> {
  return api.post(`/superadmin/company-admins/${userId}/approve`);
}

export function rejectCompanyAdmin(userId: string): Promise<void> {
  return api.post(`/superadmin/company-admins/${userId}/reject`);
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

export function searchUsers(email: string): Promise<UserSearchResult[]> {
  return api.get(`/superadmin/users?email=${encodeURIComponent(email)}`);
}

export function suspendUser(userId: string): Promise<{ id: string; suspendedAt: string }> {
  return api.post(`/superadmin/users/${userId}/suspend`);
}

export function reactivateUser(userId: string): Promise<{ id: string; suspendedAt: string | null }> {
  return api.post(`/superadmin/users/${userId}/reactivate`);
}
