import { deleteScheduledStream } from '../api/streams';
import { ApiError } from '../api/client';
import type { StreamListItem } from '../types/api';

/** Confirms, deletes an overdue scheduled stream, and returns whether it was removed. Surfaces failures via alert-free callback. */
export async function confirmAndDelete(stream: StreamListItem, onError: (message: string) => void): Promise<boolean> {
  const ok = window.confirm(
    `Delete "${stream.title}"? It was scheduled for a time that has passed and never started. Invited guests will not be emailed.`,
  );
  if (!ok) return false;
  try {
    await deleteScheduledStream(stream.id);
    return true;
  } catch (err) {
    onError(err instanceof ApiError ? err.message : 'Failed to delete the stream.');
    return false;
  }
}
