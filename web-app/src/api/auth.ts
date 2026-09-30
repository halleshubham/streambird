import { api } from './client';
import type { MeResponse } from '../types/api';

export function requestCode(email: string): Promise<{ message: string }> {
  return api.post('/auth/request-code', { email });
}

export function verifyCode(email: string, code: string): Promise<MeResponse> {
  return api.post('/auth/verify-code', { email, code });
}

export function logout(): Promise<void> {
  return api.post('/auth/logout');
}

export function me(): Promise<MeResponse> {
  return api.get('/auth/me');
}
