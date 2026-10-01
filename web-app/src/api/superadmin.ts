import { api } from './client';
import type { PendingCompanyAdmin } from '../types/api';

export function listPendingCompanyAdmins(): Promise<PendingCompanyAdmin[]> {
  return api.get('/superadmin/pending-company-admins');
}

export function approveCompanyAdmin(userId: string): Promise<{ id: string; approvedAt: string }> {
  return api.post(`/superadmin/company-admins/${userId}/approve`);
}

export function rejectCompanyAdmin(userId: string): Promise<void> {
  return api.post(`/superadmin/company-admins/${userId}/reject`);
}
