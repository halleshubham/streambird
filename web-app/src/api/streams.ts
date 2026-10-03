import { api } from './client';
import type { Destination, ScheduleDetail, Stream, StreamListResponse, StreamStatusResponse } from '../types/api';

export function listStreams(limit = 20, offset = 0, view?: 'upcoming'): Promise<StreamListResponse> {
  return api.get(`/streams?limit=${limit}&offset=${offset}${view ? `&view=${view}` : ''}`);
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

// ---- Scheduled streams ----------------------------------------------------

export interface ScheduleStreamInput {
  title: string;
  description?: string;
  /** ISO-8601 instant. */
  scheduledAt: string;
  /** IANA zone the host scheduled in -- used to render the time in invites. */
  timezone: string;
  durationMinutes?: number;
  guestNotes?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  destinationConnectionIds: string[];
  guestEmails?: string[];
  invitePassword?: string;
  /** Create the broadcast on YouTube/Facebook now instead of at start. */
  createOnPlatforms?: boolean;
}

export type UpdateScheduleInput = Partial<Omit<ScheduleStreamInput, 'guestEmails' | 'invitePassword'>> & {
  notifyGuests?: boolean;
};

export function scheduleStream(dto: ScheduleStreamInput): Promise<ScheduleDetail> {
  return api.post('/streams/schedule', dto);
}

export function getSchedule(id: string): Promise<ScheduleDetail> {
  return api.get(`/streams/${id}/schedule`);
}

export function updateSchedule(id: string, dto: UpdateScheduleInput): Promise<ScheduleDetail> {
  return api.patch(`/streams/${id}/schedule`, dto);
}

export function addScheduleGuests(id: string, emails: string[]): Promise<ScheduleDetail> {
  return api.post(`/streams/${id}/schedule/guests`, { emails });
}

export function removeScheduleGuest(id: string, inviteId: string): Promise<ScheduleDetail> {
  return api.delete(`/streams/${id}/schedule/guests/${inviteId}`);
}

export function resendScheduleInvite(id: string, inviteId: string): Promise<ScheduleDetail> {
  return api.post(`/streams/${id}/schedule/guests/${inviteId}/resend`);
}

export function cancelSchedule(id: string): Promise<void> {
  return api.post(`/streams/${id}/schedule/cancel`);
}

/** Starts a scheduled stream: creates the platform broadcasts and goes LIVE. */
export function startStream(id: string): Promise<Stream> {
  return api.post(`/streams/${id}/start`);
}

/** Silently discards a scheduled stream that never started (no guest emails, unlike cancelSchedule). */
export function deleteScheduledStream(id: string): Promise<void> {
  return api.delete(`/streams/${id}/schedule`);
}
