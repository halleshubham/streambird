import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { Platform } from '../common/enums/platform.enum';

export interface BroadcastMeta {
  title: string;
  description?: string;
  /** When set, the broadcast is scheduled for this time instead of "as soon as the provider allows" -- only YouTubeProvider currently acts on this (liveBroadcasts.insert's snippet.scheduledStartTime); providers with no real scheduling concept (Twitch) simply ignore it, same as they already ignore description where it doesn't apply. */
  scheduledAt?: Date;
  /** Only YouTubeProvider acts on this (liveBroadcasts.insert's status.privacyStatus) -- defaults to 'unlisted' there if omitted. Providers with no such concept (Twitch) ignore it. */
  visibility?: 'public' | 'unlisted' | 'private';
}

export interface BroadcastResult {
  ingestUrl: string;
  streamKey: string;
  platformBroadcastId: string;
  /** Public URL to actually watch this broadcast, or null when the provider can't produce one (see TwitchProvider). */
  watchUrl: string | null;
}

/**
 * One class per platform, one shared interface — orchestration code
 * (StreamsService) must never branch on `platform` itself, only ever
 * resolve to the matching provider and call these methods.
 */
export interface StreamProvider {
  readonly identifier: Platform;

  createBroadcast(
    conn: PlatformConnection,
    meta: BroadcastMeta,
  ): Promise<BroadcastResult>;

  endBroadcast(conn: PlatformConnection, platformBroadcastId: string): Promise<void>;

  getViewerCount?(
    conn: PlatformConnection,
    platformBroadcastId: string,
  ): Promise<number>;

  /**
   * The platform's OWN real lifecycle status for this broadcast (e.g.
   * YouTube's created/ready/testing/live/complete/revoked), distinct from
   * and more trustworthy than this app's own LiveStreamDestination.status
   * -- that field flips to LIVE as soon as we've successfully configured
   * forwarding to the destination, which is NOT the same as the platform
   * actually having received real stream data yet (see
   * StreamsService.getStatus(), which surfaces this alongside the
   * optimistic internal status specifically to make that gap visible).
   */
  getBroadcastStatus?(
    conn: PlatformConnection,
    platformBroadcastId: string,
  ): Promise<string | null>;
}
