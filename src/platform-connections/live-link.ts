import * as crypto from 'crypto';
import { Platform } from '../common/enums/platform.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { StreamStatus } from '../common/enums/stream-status.enum';

/** Lowercase base32 (no 0/1/8/9, so nothing looks like anything else). 32 symbols = exactly 5 bits per random byte. */
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const LIVE_SLUG_LENGTH = 10;

/** Only YouTube channels and Facebook Pages have a public page to send people to. */
export function platformHasLiveLink(platform: Platform): boolean {
  return platform === Platform.YOUTUBE || platform === Platform.FACEBOOK;
}

/** A random 10-character slug (50 bits). Unguessable enough to be an unlisted link; uniqueness is the DB's job. */
export function generateLiveSlug(): string {
  const bytes = crypto.randomBytes(LIVE_SLUG_LENGTH);
  let out = '';
  for (const b of bytes) out += SLUG_ALPHABET[b & 31];
  return out;
}

/** Cheap shape check so junk never reaches the database. */
export function isPlausibleLiveSlug(slug: string): boolean {
  return /^[a-z0-9]{6,32}$/.test(slug);
}

export function buildLiveLinkUrl(publicBaseUrl: string, slug: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/stream/${slug}`;
}

export interface LiveLinkCandidate {
  watchUrl: string | null;
  destinationStatus: DestinationStatus;
  streamStatus: StreamStatus;
  createdAt: Date;
}

function isHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The newest destination whose stream and destination are both live and that has a usable watch URL, else null. */
export function pickLiveWatchUrl(candidates: LiveLinkCandidate[]): string | null {
  const live = candidates
    .filter((c) => c.streamStatus === StreamStatus.LIVE && c.destinationStatus === DestinationStatus.LIVE && isHttpUrl(c.watchUrl))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return live.length ? live[0].watchUrl : null;
}

/** The public channel/page URL, built by the server from the stored platform id (never from user input). */
export function channelUrlFor(platform: Platform, externalAccountId: string): string | null {
  const id = encodeURIComponent(externalAccountId);
  if (platform === Platform.YOUTUBE) return `https://www.youtube.com/channel/${id}`;
  if (platform === Platform.FACEBOOK) return `https://www.facebook.com/${id}`;
  return null;
}
