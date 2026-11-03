import { api } from './client';
import type { DeletionPreview } from '../types/api';

/** What deleting my account would remove (shown as a warning before anything is sent). */
export function getDeletionPreview(): Promise<DeletionPreview> {
  return api.get('/account/delete/preview');
}

/** Emails a 6-digit confirmation code to my address. */
export function requestDeletionCode(): Promise<void> {
  return api.post('/account/delete/request');
}

/** Deletes my account (or the whole company when I am its only admin). 409 = confirmCompanyDeletion is required. */
export function deleteMyAccount(code: string, confirmCompanyDeletion: boolean): Promise<void> {
  return api.delete('/account', { code, confirmCompanyDeletion });
}
