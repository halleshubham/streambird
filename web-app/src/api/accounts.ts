import { api } from './client';
import type { Account } from '../types/api';

export function getMyAccount(): Promise<Account> {
  return api.get('/accounts/me');
}
