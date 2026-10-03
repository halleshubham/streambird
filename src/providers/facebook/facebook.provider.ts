import { Injectable } from '@nestjs/common';
import { Platform } from '../../common/enums/platform.enum';
import { EncryptionService } from '../../encryption/encryption.service';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { BroadcastMeta, BroadcastResult, StreamProvider } from '../stream-provider.interface';
import type { ThumbnailImage } from '../../streams/thumbnail.util';

export interface FacebookCredentials {
  pageAccessToken: string;
  pageId: string;
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

/** A Graph API error with Meta's own error code, so callers can tell "wrong format, try another" (1/2/100) from "not allowed" (3/190). */
export class FacebookApiError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'FacebookApiError';
  }
}

/** Codes that mean the request itself was unacceptable (generic error, service error, invalid parameter) -- worth retrying in a different shape. Not 3 (capability) or 190 (token): another shape won't change those. */
const RETRY_WITH_OTHER_FORMAT = new Set([1, 2, 100]);

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
  readonly canPrescheduleBroadcast = true;
  /** Meta's Live Video API: broadcasts can be scheduled "up to seven days from their creation date". */
  readonly maxPrescheduleLeadMs = 7 * 24 * 60 * 60_000;

  constructor(private readonly encryption: EncryptionService) {}

  private async callApi<T>(
    path: string,
    accessToken: string,
    init?: { method?: string; body?: Record<string, string>; form?: FormData },
  ): Promise<T> {
    const method = init?.method ?? 'GET';
    const params = new URLSearchParams({ ...(init?.body ?? {}), access_token: accessToken });
    if (init?.form) init.form.set('access_token', accessToken);

    const url =
      method === 'GET'
        ? `${GRAPH_API_BASE}${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
        : `${GRAPH_API_BASE}${path}`;

    const res = await fetch(url, {
      method,
      ...(init?.form
        ? // multipart: fetch sets the Content-Type (with boundary) itself
          { body: init.form }
        : method !== 'GET'
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
      const reconnectHint =
        err?.code === 190
          ? ' -- reconnect this Facebook Page to fix this.'
          : err?.code === 3
            ? ' -- Meta says this app lacks the capability for this call (scheduled live videos can be restricted separately from going live now).'
            : '';
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
      throw new FacebookApiError(
        `Facebook API ${method} ${path} failed (${res.status}): ${err?.message ?? 'unknown error'}${detail ? ` (${detail})` : ''}${reconnectHint}`,
        err?.code,
        res.status,
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

  /**
   * LIVE_NOW (Meta's default) means "go live the moment RTMP data actually
   * arrives" -- not a literal instant transition -- the same
   * enableAutoStart-style semantics YouTubeProvider relies on. A
   * pre-created broadcast for a scheduled stream is instead created as a
   * scheduled live video with a start time (up to 7 days ahead), which shows up in the
   * Page's Live Producer: hidden from the public (SCHEDULED_UNPUBLISHED)
   * unless the host chose public visibility, in which case Facebook also
   * posts the upcoming-live promo to the Page (SCHEDULED_LIVE) -- mirroring
   * YouTubeProvider's "never publicly visible unless asked" default.
   */
  /**
   * Meta documents the scheduled start time two incompatible ways: the
   * reference types `event_params` as an object (`{start_time, cover}`),
   * the scheduling guide shows a bare UNIX timestamp. Which one a given
   * app/Page accepts isn't knowable from the docs, so callers try the
   * object form first and fall back to the plain timestamp.
   */
  private eventParamsVariants(at: Date): Array<{ event_params: string }> {
    const ts = Math.floor(at.getTime() / 1000);
    return [{ event_params: JSON.stringify({ start_time: ts }) }, { event_params: String(ts) }];
  }

  async updateBroadcast(conn: PlatformConnection, platformBroadcastId: string, meta: BroadcastMeta): Promise<void> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, {
      method: 'POST',
      body: { title: meta.title, description: meta.description ?? '' },
    });

    // Changing the start time of an existing scheduled live isn't documented
    // by Meta, so it is a separate best-effort call: the title/description
    // above must not be lost if Facebook rejects it.
    if (meta.scheduledAt) {
      let lastError: Error | undefined;
      for (const variant of this.eventParamsVariants(meta.scheduledAt)) {
        try {
          await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, { method: 'POST', body: variant });
          return;
        } catch (err) {
          lastError = err as Error;
        }
      }
      throw new Error(`title and description were updated, but Facebook did not accept the new start time (${lastError?.message})`);
    }
  }

  /**
   * The image shown in a scheduled live's story and lobby
   * (`schedule_custom_profile_image` on the live video). Meta documents it
   * on creation; whether an existing scheduled live accepts it on update
   * isn't documented, so a rejection is expected to be reported as a
   * warning by the caller, not treated as an error.
   */
  async setBroadcastThumbnail(conn: PlatformConnection, platformBroadcastId: string, image: ThumbnailImage): Promise<void> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    const form = new FormData();
    const ext = image.contentType === 'image/png' ? 'png' : 'jpg';
    form.set('schedule_custom_profile_image', new Blob([new Uint8Array(image.data)], { type: image.contentType }), `thumbnail.${ext}`);
    await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, { method: 'POST', form });
  }

  async deleteBroadcast(conn: PlatformConnection, platformBroadcastId: string): Promise<void> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, { method: 'DELETE' });
  }

  /** A scheduled live video is told to go live now when the host actually starts, so data arriving on its stream URL airs immediately. */
  async prepareToGoLive(conn: PlatformConnection, platformBroadcastId: string): Promise<void> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    await this.callApi(`/${platformBroadcastId}`, creds.pageAccessToken, {
      method: 'POST',
      body: { status: 'LIVE_NOW' },
    });
  }

  async createBroadcast(conn: PlatformConnection, meta: BroadcastMeta): Promise<BroadcastResult> {
    const creds = this.encryption.decrypt<FacebookCredentials>(conn.credentialsCiphertext);
    const scheduled = !!(meta.precreate && meta.scheduledAt);

    const baseFields = { title: meta.title, description: meta.description ?? '' };
    const scheduledStatus = meta.visibility === 'public' ? 'SCHEDULED_LIVE' : 'SCHEDULED_UNPUBLISHED';
    const attempts: Array<Record<string, string>> = scheduled
      ? this.eventParamsVariants(meta.scheduledAt!).map((variant) => ({ ...baseFields, status: scheduledStatus, ...variant }))
      : [{ ...baseFields, status: 'LIVE_NOW' }];

    let result: { id: string; secure_stream_url: string } | undefined;
    const failures: string[] = [];
    for (const [i, body] of attempts.entries()) {
      try {
        result = await this.callApi<{ id: string; secure_stream_url: string }>(`/${creds.pageId}/live_videos`, creds.pageAccessToken, {
          method: 'POST',
          body,
        });
        break;
      } catch (err) {
        failures.push((err as Error).message);
        const last = i === attempts.length - 1;
        const retryable = err instanceof FacebookApiError && err.code !== undefined && RETRY_WITH_OTHER_FORMAT.has(err.code);
        if (last || !retryable) {
          // Only the first failure matters when we never got to try the other shape.
          const also = failures.length > 1 ? ` -- an alternative request format was tried first and failed too: ${failures[0]}` : '';
          throw err instanceof FacebookApiError ? new FacebookApiError(`${(err as Error).message}${also}`, err.code, err.httpStatus) : err;
        }
      }
    }

    const { ingestUrl, streamKey } = this.splitStreamUrl(result!.secure_stream_url);

    return {
      ingestUrl,
      streamKey,
      platformBroadcastId: result!.id,
      // Meta resolves any object id to its canonical permalink -- the same
      // "one stable, always-correct" reasoning YouTubeProvider's own watch
      // URL comment uses, just via Facebook's own id-based permalink form.
      watchUrl: `https://www.facebook.com/${result!.id}`,
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
