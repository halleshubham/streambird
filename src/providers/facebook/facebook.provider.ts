import { Injectable } from '@nestjs/common';
import { Platform } from '../../common/enums/platform.enum';
import { EncryptionService } from '../../encryption/encryption.service';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { BroadcastMeta, BroadcastResult, StreamProvider } from '../stream-provider.interface';

export interface FacebookCredentials {
  pageAccessToken: string;
  pageId: string;
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

/**
 * Unlike YouTubeProvider, there is no refresh flow here at all: a Page
 * access token derived from a long-lived user token (see
 * PlatformConnectionsController's facebook/callback) doesn't expire via any
 * refresh call Meta exposes -- it just eventually fails (Graph API error
 * code 190, OAuthException) if the grant is revoked or the user's password
 * changes, at which point the only fix is reconnecting from scratch. So
 * this class never touches conn.credentialsCiphertext after it's first
 * stored, and callApi() specifically recognizes a 190 error to say
 * "reconnect" instead of surfacing a generic failure.
 *
 * Also unlike YouTube's JSON API, the Graph API takes form-encoded POST
 * bodies, and `POST /{page-id}/live_videos` returns a single
 * `secure_stream_url` that's already the full RTMPS push target (format
 * `rtmps://host:port/rtmp/<key>[?query]`) rather than separate
 * ingest-address + stream-name fields -- see splitStreamUrl() below.
 */
@Injectable()
export class FacebookProvider implements StreamProvider {
  readonly identifier = Platform.FACEBOOK;

  constructor(private readonly encryption: EncryptionService) {}

  private async callApi<T>(
    path: string,
    accessToken: string,
    init?: { method?: string; body?: Record<string, string> },
  ): Promise<T> {
    const method = init?.method ?? 'GET';
    const params = new URLSearchParams({ ...(init?.body ?? {}), access_token: accessToken });

    const url =
      method === 'GET'
        ? `${GRAPH_API_BASE}${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
        : `${GRAPH_API_BASE}${path}`;

    const res = await fetch(url, {
      method,
      ...(method !== 'GET'
        ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
        : {}),
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: {
        code?: number;
        error_subcode?: number;
        type?: string;
        message?: string;
        error_user_title?: string;
        error_user_msg?: string;
        fbtrace_id?: string;
      };
    };

    if (!res.ok || body.error) {
      const err = body.error;
      const reconnectHint = err?.code === 190 ? ' -- reconnect this Facebook Page to fix this.' : '';
      // Graph API's own `message` is often generic ("Permissions error") --
      // `type`/`code`/`error_subcode` and the user-facing fields pin down
      // WHICH permission/App Review gap it actually is, and `fbtrace_id` is
      // what Meta's own support tools look up by.
      const detail = [
        err?.type && err?.code !== undefined ? `${err.type} ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''}` : null,
        err?.error_user_title,
        err?.error_user_msg,
        err?.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : null,
      ]
        .filter(Boolean)
        .join(' -- ');
      throw new Error(
        `Facebook API ${method} ${path} failed (${res.status}): ${err?.message ?? 'unknown error'}${detail ? ` (${detail})` : ''}${reconnectHint}`,
      );
    }
    return body as T;
  }

  /**
   * Splits a Graph API stream URL into the (ingestUrl, streamKey) shape
   * this app's StreamProvider interface expects, generically at the LAST
   * "/" -- not by assuming any particular internal structure. This exactly
   * reconstructs the original URL via the same
   * `${ingestUrl.replace(/\/$/, '')}/${streamKey}` convention
   * StreamsService already uses for every destination, so it's robust
   * whether or not Facebook's key segment carries a trailing query string.
   */
  private splitStreamUrl(url: string): { ingestUrl: string; streamKey: string } {
    const idx = url.lastIndexOf('/');
    return { ingestUrl: url.slice(0, idx), streamKey: url.slice(idx + 1) };
  }

  async createBroadcast(conn: PlatformConnection, meta: BroadcastMeta): Promise<BroadcastResult> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);

    const result = await this.callApi<{ id: string; secure_stream_url: string }>(
      `/${creds.pageId}/live_videos`,
      creds.pageAccessToken,
      {
        method: 'POST',
        body: {
          title: meta.title,
          description: meta.description ?? '',
          // LIVE_NOW (Meta's default) means "go live the moment RTMP data
          // actually arrives" -- not a literal instant transition -- the
          // same enableAutoStart-style semantics YouTubeProvider relies on.
          status: 'LIVE_NOW',
        },
      },
    );

    const { ingestUrl, streamKey } = this.splitStreamUrl(result.secure_stream_url);

    return {
      ingestUrl,
      streamKey,
      platformBroadcastId: result.id,
      // The Page-scoped form. A bare facebook.com/<videoId> does not resolve
      // to the video for Page live videos (it lands on a wrong/blank page).
      watchUrl: `https://www.facebook.com/${creds.pageId}/videos/${result.id}`,
    };
  }

  /**
   * Facebook's own lifecycle status for this live video --
   * 'UNPUBLISHED' | 'LIVE' | 'LIVE_STOPPED' | 'PROCESSING' | 'VOD' | etc.
   * Passed through raw, exactly like YouTubeProvider's own
   * lifeCycleStatus passthrough.
   */
  async getBroadcastStatus(conn: PlatformConnection, platformBroadcastId: string): Promise<string | null> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    const result = await this.callApi<{ status?: string }>(
      `/${platformBroadcastId}?fields=status`,
      creds.pageAccessToken,
    );
    return result.status ?? null;
  }

  async endBroadcast(conn: PlatformConnection, platformBroadcastId: string): Promise<void> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    try {
      await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, {
        method: 'POST',
        body: { end_live_video: 'true' },
      });
    } catch {
      // A live video that already stopped (or never made it live) failing
      // here is expected, not an error worth surfacing -- same tolerance
      // as YouTubeProvider.endBroadcast.
    }
  }

  async getViewerCount(conn: PlatformConnection, platformBroadcastId: string): Promise<number> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    const result = await this.callApi<{ live_views?: number }>(
      `/${platformBroadcastId}?fields=live_views`,
      creds.pageAccessToken,
    );
    return result.live_views ?? 0;
  }
}
