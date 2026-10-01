import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Platform } from '../../common/enums/platform.enum';
import { EncryptionService } from '../../encryption/encryption.service';
import { GoogleOAuthService } from '../../auth/google-oauth.service';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { BroadcastMeta, BroadcastResult, StreamProvider } from '../stream-provider.interface';

export interface YouTubeCredentials {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms -- accessToken is refreshed proactively once within REFRESH_SKEW_MS of this. */
  expiresAt: number;
  channelId: string;
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
// Refresh a bit before actual expiry so a slow createBroadcast() call never
// straddles the token going stale mid-request.
const REFRESH_SKEW_MS = 60_000;

/**
 * Unlike Twitch (a static ingest URL/key with no broadcast object) or a
 * hypothetical "just hand me an RTMP endpoint" platform, YouTube requires
 * three API calls to actually go live: create the broadcast (the event:
 * title, schedule, privacy), create the stream (the actual RTMP
 * ingestion endpoint + key), then bind them together. `enableAutoStart`/
 * `enableAutoStop` are set so YouTube itself flips the broadcast live the
 * moment it sees our RTMP stream arrive, and ends it the moment the
 * stream stops -- no separate `liveBroadcasts.transition` call is needed
 * to actually go live, only (optionally, as a safety net) to end it.
 */
@Injectable()
export class YouTubeProvider implements StreamProvider {
  readonly identifier = Platform.YOUTUBE;

  constructor(
    private readonly encryption: EncryptionService,
    private readonly googleOAuth: GoogleOAuthService,
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
  ) {}

  /**
   * Returns a currently-valid access token, transparently refreshing (and
   * persisting the refreshed token back onto the connection row) if it's
   * at or near expiry. Every other method in this class should go through
   * this rather than decrypting conn.credentialsCiphertext directly.
   */
  private async getValidAccessToken(conn: PlatformConnection): Promise<string> {
    const creds = this.encryption.decrypt<YouTubeCredentials>(conn.credentialsCiphertext);

    if (Date.now() < creds.expiresAt - REFRESH_SKEW_MS) {
      return creds.accessToken;
    }

    const refreshed = await this.googleOAuth.refreshAccessToken(creds.refreshToken);
    const updated: YouTubeCredentials = {
      ...creds,
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + refreshed.expiresInSeconds * 1000,
    };
    await this.connections.update(conn.id, {
      credentialsCiphertext: this.encryption.encrypt(updated),
    });
    return updated.accessToken;
  }

  private async callApi<T>(
    path: string,
    accessToken: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await fetch(`${YOUTUBE_API_BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async createBroadcast(conn: PlatformConnection, meta: BroadcastMeta): Promise<BroadcastResult> {
    const accessToken = await this.getValidAccessToken(conn);

    // YouTube rejects a scheduledStartTime in the past, and (per its docs)
    // expects it to be in the future even for a broadcast meant to start
    // immediately -- a few seconds out is the conventional way to express
    // "go live now" when enableAutoStart will flip it live as soon as the
    // RTMP stream actually arrives anyway.
    const scheduledStartTime = (meta.scheduledAt ?? new Date(Date.now() + 10_000)).toISOString();

    const broadcast = await this.callApi<{ id: string }>(
      '/liveBroadcasts?part=snippet,status,contentDetails',
      accessToken,
      {
        method: 'POST',
        body: {
          snippet: {
            title: meta.title,
            description: meta.description ?? '',
            scheduledStartTime,
          },
          status: {
            // Unlisted by default -- a public StreamBird broadcast going
            // live on a connected channel without the caller choosing
            // that visibility would be a surprising default to ship.
            privacyStatus: meta.visibility ?? 'unlisted',
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: true,
          },
        },
      },
    );

    const stream = await this.callApi<{
      id: string;
      cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } };
    }>('/liveStreams?part=snippet,cdn', accessToken, {
      method: 'POST',
      body: {
        snippet: { title: meta.title },
        cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' },
      },
    });

    await this.callApi(
      `/liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id`,
      accessToken,
      { method: 'POST' },
    );

    return {
      ingestUrl: stream.cdn.ingestionInfo.ingestionAddress,
      streamKey: stream.cdn.ingestionInfo.streamName,
      platformBroadcastId: broadcast.id,
      // The broadcast id doubles as the video id -- this is the one stable,
      // always-correct way to construct the watch URL, true even before
      // the broadcast actually starts receiving data.
      watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
    };
  }

  /**
   * YouTube's own lifecycle status for this broadcast -- 'created' | 'ready'
   * | 'testing' | 'live' | 'complete' | 'revoked'. Critically, this is the
   * only trustworthy way to know whether YouTube has actually started
   * receiving real RTMP data: enableAutoStart (see createBroadcast) only
   * flips YouTube's OWN status to 'live' once real data arrives -- it does
   * NOT mean our own LiveStreamDestination.status=LIVE (set as soon as
   * MediaMTX forwarding is configured, regardless of whether any data has
   * actually flowed yet) is telling the truth about what's on-air.
   */
  async getBroadcastStatus(
    conn: PlatformConnection,
    platformBroadcastId: string,
  ): Promise<string | null> {
    const accessToken = await this.getValidAccessToken(conn);
    const result = await this.callApi<{
      items: Array<{ status?: { lifeCycleStatus?: string } }>;
    }>(`/liveBroadcasts?part=status&id=${platformBroadcastId}`, accessToken);

    return result.items[0]?.status?.lifeCycleStatus ?? null;
  }

  async endBroadcast(conn: PlatformConnection, platformBroadcastId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(conn);
    try {
      await this.callApi(
        `/liveBroadcasts/transition?broadcastStatus=complete&id=${platformBroadcastId}&part=id`,
        accessToken,
        { method: 'POST' },
      );
    } catch {
      // enableAutoStop already completes the broadcast the moment our RTMP
      // stream stops -- this explicit transition is only a safety net for
      // whatever gap exists between "we stopped publishing" and "YouTube
      // noticed," so a broadcast that's already complete (or never made it
      // to a biddable state) failing here is expected, not an error worth
      // surfacing to the caller.
    }
  }

  async getViewerCount(conn: PlatformConnection, platformBroadcastId: string): Promise<number> {
    const accessToken = await this.getValidAccessToken(conn);
    const result = await this.callApi<{
      items: Array<{ liveStreamingDetails?: { concurrentViewers?: string } }>;
    }>(`/videos?part=liveStreamingDetails&id=${platformBroadcastId}`, accessToken);

    const raw = result.items[0]?.liveStreamingDetails?.concurrentViewers;
    return raw ? parseInt(raw, 10) : 0;
  }
}
