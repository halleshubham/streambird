import { api } from './client';
import type { PresetConfig, StartedFromPreset, StreamPreset } from '../types/api';

export function listPresets(): Promise<StreamPreset[]> {
  return api.get('/presets');
}

export function createPreset(name: string, config: PresetConfig): Promise<StreamPreset> {
  return api.post('/presets', { name, config });
}

export function updatePreset(id: string, patch: { name?: string; config?: PresetConfig }): Promise<StreamPreset> {
  return api.patch(`/presets/${id}`, patch);
}

export function deletePreset(id: string): Promise<void> {
  return api.delete(`/presets/${id}`);
}

/** Creates the stream from the preset (like POST /streams) and returns it with how the preset applies today. */
export function startPreset(id: string, title?: string): Promise<StartedFromPreset> {
  return api.post(`/presets/${id}/start`, title ? { title } : {});
}
