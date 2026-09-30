import { api } from './client';
import type { Stream, StreamListResponse } from '../types/api';

export function listStreams(limit = 20, offset = 0): Promise<StreamListResponse> {
  return api.get(`/streams?limit=${limit}&offset=${offset}`);
}

export function getStream(id: string): Promise<Stream> {
  return api.get(`/streams/${id}`);
}

export function createStream(dto: {
  title: string;
  description?: string;
  scheduledAt?: string;
  destinationConnectionIds: string[];
}): Promise<Stream> {
  return api.post('/streams', dto);
}

export function endStream(id: string): Promise<Stream> {
  return api.post(`/streams/${id}/end`);
}
