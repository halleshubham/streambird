import { api } from './client';
import type { PlatformConnection } from '../types/api';

export function listConnections(): Promise<PlatformConnection[]> {
  return api.get('/platform-connections');
}

export function connectTwitchManual(dto: {
  label: string;
  ingestServerUrl: string;
  streamKey: string;
}): Promise<PlatformConnection> {
  return api.post('/platform-connections/twitch/manual', dto);
}

export function removeConnection(id: string): Promise<void> {
  return api.delete(`/platform-connections/${id}`);
}
