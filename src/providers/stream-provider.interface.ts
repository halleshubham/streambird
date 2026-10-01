import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { Platform } from '../common/enums/platform.enum';

export interface BroadcastMeta {
  title: string;
  description?: string;
  /** When set, the broadcast is scheduled for this time instead of "as soon as the provider allows" -- only YouTubeProvider currently acts on this (liveBroadcasts.insert's snippet.scheduledStartTime); providers with no real scheduling concept (Twitch) simply ignore it, same as they already ignore description where it doesn't apply. */
  scheduledAt?: Date;
}

export interface BroadcastResult {
  ingestUrl: string;
  streamKey: string;
  platformBroadcastId: string;
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
}
