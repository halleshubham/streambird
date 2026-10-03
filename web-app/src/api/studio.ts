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

/** Public, same as resolveInvite -- host and guest both need this before
 * negotiating WebRTC and authenticate completely differently, so neither
 * gate applies. Short-lived credentials only; see TurnCredentialsService
 * server-side for why the actual API token never reaches this layer. */
export function getTurnCredentials(): Promise<{ iceServers: RTCIceServer[] }> {
  return api.get('/studio-sessions/turn-credentials');
}
