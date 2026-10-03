import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { Platform } from '../common/enums/platform.enum';

export interface BroadcastMeta {
  title: string;
  description?: string;
  /** When set, the broadcast is scheduled for this time instead of "as soon as the provider allows" -- only YouTubeProvider currently acts on this (liveBroadcasts.insert's snippet.scheduledStartTime); providers with no real scheduling concept (Twitch) simply ignore it, same as they already ignore description where it doesn't apply. */
  scheduledAt?: Date;
  /** Only YouTubeProvider acts on this (liveBroadcasts.insert's status.privacyStatus) -- defaults to 'unlisted' there if omitted. Providers with no such concept (Twitch) ignore it. */
  visibility?: 'public' | 'unlisted' | 'private';
  /**
   * Set only when a scheduled StreamBird stream creates the platform-side
   * broadcast ahead of time (see StreamSchedulingService) -- providers that
   * can hold a future broadcast (Facebook) then create it as a scheduled
   * one instead of "live as soon as data arrives". Never set by the
   * go-live-now path, which must keep behaving exactly as before.
   */
  precreate?: boolean;
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

  /**
   * True when the platform can hold a broadcast scheduled for a future time
   * (YouTube, Facebook) -- so a scheduled StreamBird stream can create it
   * ahead of time and have it show up on the platform. Twitch has no such
   * concept and is only ever created at start.
   */
  readonly canPrescheduleBroadcast?: boolean;

  /** Re-syncs a pre-created broadcast's title/description/time/visibility after the host edits the schedule. */
  updateBroadcast?(conn: PlatformConnection, platformBroadcastId: string, meta: BroadcastMeta): Promise<void>;

  /** Removes a pre-created broadcast from the platform (the scheduled stream was cancelled/deleted, or the destination dropped). Best-effort. */
  deleteBroadcast?(conn: PlatformConnection, platformBroadcastId: string): Promise<void>;

  /** Called when a pre-created broadcast is about to receive data, for platforms that need an explicit "go live" nudge (Facebook). Best-effort. */
  prepareToGoLive?(conn: PlatformConnection, platformBroadcastId: string): Promise<void>;

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
