import { api } from './client';
import type { CreateInviteResponse, HostTokenResponse, ResolveInviteResponse } from '../types/api';

export function mintHostToken(studioSessionId: string): Promise<HostTokenResponse> {
  return api.post(`/studio-sessions/${studioSessionId}/host-token`);
}

export function createInvite(
  studioSessionId: string,
  opts: { label?: string; password?: string } = {},
): Promise<CreateInviteResponse> {
  return api.post(`/studio-sessions/${studioSessionId}/invites`, opts);
}

export function updateLayout(
  studioSessionId: string,
  layoutConfig: Record<string, unknown>,
): Promise<void> {
  return api.patch(`/studio-sessions/${studioSessionId}/layout`, { layoutConfig });
}

/** Public -- no session cookie needed, but api.get sends credentials:'include' harmlessly. */
export function resolveInvite(token: string): Promise<ResolveInviteResponse> {
  return api.get(`/studio-sessions/invites/${encodeURIComponent(token)}`);
}
