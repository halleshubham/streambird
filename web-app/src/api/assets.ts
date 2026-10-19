import { api } from './client';
import type { AssetKind, AssetLibrary, BrandKit, BrandKitInput } from '../types/api';

export function listAssets(): Promise<AssetLibrary> {
  return api.get('/assets');
}

export function uploadAsset(file: File, kind: AssetKind, name?: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('kind', kind);
  if (name) form.append('name', name);
  form.append('file', file);
  return api.postForm('/assets', form);
}

export function renameAsset(id: string, name: string): Promise<{ id: string; name: string }> {
  return api.patch(`/assets/${id}`, { name });
}

export function deleteAsset(id: string): Promise<void> {
  return api.delete(`/assets/${id}`);
}

/** The image itself (same-origin, session cookie), for <img src> and the studio canvas. */
export function assetFileUrl(id: string): string {
  return `/api/assets/${id}/file`;
}

export function listBrandKits(): Promise<BrandKit[]> {
  return api.get('/brand-kits');
}

export function createBrandKit(input: BrandKitInput): Promise<BrandKit> {
  return api.post('/brand-kits', input);
}

export function updateBrandKit(id: string, input: Partial<BrandKitInput>): Promise<BrandKit> {
  return api.patch(`/brand-kits/${id}`, input);
}

export function deleteBrandKit(id: string): Promise<void> {
  return api.delete(`/brand-kits/${id}`);
}

/** Points a connection at a kit; null sends it back to the account default. */
export function assignBrandKit(connectionId: string, brandKitId: string | null): Promise<{ connectionId: string; brandKitId: string | null }> {
  return api.put(`/brand-kits/connections/${connectionId}`, { brandKitId });
}
