/**
 * "Go live now" uploads the thumbnail in the background (going live must not wait on it), so its result
 * is handed to the studio through sessionStorage plus a window event (the upload can finish before or
 * after the studio has opened).
 */
const key = (streamId: string) => `streambird:thumbnail-notice:${streamId}`;
export const THUMBNAIL_NOTICE_EVENT = 'streambird:thumbnail-notice';

export function rememberThumbnailNotice(streamId: string, messages: string[]): void {
  try {
    sessionStorage.setItem(key(streamId), JSON.stringify(messages));
  } catch {
    // Storage blocked: the notice is simply lost, the upload itself is unaffected.
  }
  window.dispatchEvent(new CustomEvent(THUMBNAIL_NOTICE_EVENT, { detail: streamId }));
}

export function readThumbnailNotice(streamId: string): string[] {
  try {
    const raw = sessionStorage.getItem(key(streamId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export function clearThumbnailNotice(streamId: string): void {
  try {
    sessionStorage.removeItem(key(streamId));
  } catch {
    // nothing to clear
  }
}
