import { api } from './client';
import type { TeamMember } from '../types/api';

export function listTeam(): Promise<TeamMember[]> {
  return api.get('/team');
}

export function inviteTeamMember(email: string): Promise<TeamMember> {
  return api.post('/team/invite', { email });
}

export function removeTeamMember(userId: string): Promise<void> {
  return api.delete(`/team/${userId}`);
}
