import { deleteScheduledStream } from '../api/streams';
import { ApiError } from '../api/client';
import type { StreamListItem } from '../types/api';
import { confirm } from '../components/ui';

/** Confirms, deletes an overdue scheduled stream, and returns whether it was removed. Surfaces failures via alert-free callback. */
export async function confirmAndDelete(stream: StreamListItem, onError: (message: string) => void): Promise<boolean> {
  const ok = await confirm({
    title: `Delete "${stream.title}"?`,
    body: 'It was scheduled for a time that has passed and never started. The invitation link stops working and invited guests are not emailed. This cannot be undone.',
    confirmLabel: 'Delete stream',
    cancelLabel: 'Keep stream',
    destructive: true,
  });
  if (!ok) return false;
  try {
    await deleteScheduledStream(stream.id);
    return true;
  } catch (err) {
    onError(err instanceof ApiError ? err.message : 'Failed to delete the stream.');
    return false;
  }
}
