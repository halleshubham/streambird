import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { Platform } from '../common/enums/platform.enum';

export interface BroadcastMeta {
  title: string;
  description?: string;
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
