import { api } from './client';
import type { EffectiveLimits, PublicPlan } from '../types/api';

export function getPublicPlans(): Promise<PublicPlan[]> {
  return api.get('/plans/public');
}

export function getMyLimits(): Promise<EffectiveLimits> {
  return api.get('/plans/me');
}
