import { api } from './client';
import type { Destination, Stream, StreamListResponse, StreamStatusResponse } from '../types/api';

export function listStreams(limit = 20, offset = 0): Promise<StreamListResponse> {
  return api.get(`/streams?limit=${limit}&offset=${offset}`);
}

export function getStream(id: string): Promise<Stream> {
  return api.get(`/streams/${id}`);
}

export function getStreamStatus(id: string): Promise<StreamStatusResponse> {
  return api.get(`/streams/${id}/status`);
}

export function createStream(dto: {
  title: string;
  description?: string;
  scheduledAt?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  destinationConnectionIds: string[];
}): Promise<Stream> {
  return api.post('/streams', dto);
}

export function retryDestination(streamId: string, destinationId: string): Promise<Destination> {
  return api.post(`/streams/${streamId}/destinations/${destinationId}/retry`);
}

export function endStream(id: string): Promise<Stream> {
  return api.post(`/streams/${id}/end`);
}
