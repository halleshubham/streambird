import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Self-hosted MediaMTX instance, used as the universal WHIP publish
 * front-door for the browser host studio.
 *
 * Why this exists: Cloudflare's WHIP ingest doesn't (as of this writing)
 * transcode into any other downstream format -- RTMP simulcast to Twitch/
 * YouTube and Cloudflare's own hosted player both stayed dark for a
 * WHIP-sourced live input, confirmed by Cloudflare support. RTMP ingest,
 * on the other hand, has always worked correctly. Mux has no WHIP ingest
 * at all. So instead of publishing WHIP directly to a RelayProvider, the
 * host's browser always publishes WHIP to this MediaMTX instance, which
 * forwards the same stream onward as RTMP -- directly to every ready
 * destination's own ingest (Twitch etc.), and additionally to a
 * RelayProvider's ingest if one is configured (see StreamsService.create(),
 * which checks RelayProvider.isConfigured()). A RelayProvider is therefore
 * no longer in the platform-delivery critical path at all; it's an optional
 * extra forward used only for its own features (hosted preview, recording).
 * If/when Cloudflare ships a WHIP ingest that itself transcodes correctly,
 * this whole MediaMTX hop can be dropped in favor of publishing WHIP
 * straight to it -- keep this service's boundary clean for that.
 *
 * The RTMP push itself goes through a `runOnReady` ffmpeg command, not
 * MediaMTX's own built-in `forward` field -- confirmed live (2026-09-30)
 * that `forward` gets an instant EOF from both Twitch and Cloudflare, TLS
 * and non-TLS alike, while a plain ffmpeg RTMP push from the same host with
 * the same key works perfectly. RTMP/FLV has no codec slot for Opus (only
 * Enhanced-RTMP-aware receivers accept it), and WHIP's audio is always
 * Opus, so every native `forward` attempt was rejected before a single
 * frame went out. ffmpeg pulls the path back over local RTSP and
 * transcodes audio only (video stays `-c:v copy`) to fix that, teeing to
 * every destination in one process. This needs the "-ffmpeg" image variant
 * (see docker-compose.yaml) -- the default image has neither a shell nor
 * ffmpeg, and `runOnReady` is just a shell command.
 *
 * Each LiveStream gets its own MediaMTX path (named after the stream's own
 * id), registered/removed at runtime via MediaMTX's Control API rather
 * than static config, since the RTMP forward destinations (each
 * destination's ingest URL + per-stream key) are only known once
 * StreamsService.create() has resolved them.
 */
@Injectable()
export class MediaMtxService {
  private readonly logger = new Logger(MediaMtxService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get apiUrl(): string {
    return this.config.get<string>('mediamtx.apiUrl') ?? '';
  }

  private get authConfig() {
    return {
      auth: {
        username: this.config.get<string>('mediamtx.apiUser') ?? '',
        password: this.config.get<string>('mediamtx.apiPassword') ?? '',
      },
    };
  }

  /**
   * Wraps a value in single quotes for safe interpolation into the shell
   * command line MediaMTX runs for `runOnReady` -- every rtmpDest is
   * provider-returned data (a platform's ingest URL/key), not something we
   * fully control, so it crosses a real shell-injection boundary here.
   * Single-quoting neutralizes every shell metacharacter except a literal
   * single quote, which this escapes the standard POSIX way.
   */
  private shQuote(value: string): string {
    return `'${value.split("'").join(`'\\''`)}'`;
  }

  /**
   * Builds the `runOnReady` command that pulls this path back over its own
   * local RTSP server and tees an audio-transcoded (video copied) RTMP push
   * to every destination -- see the class doc for why this replaces
   * MediaMTX's native `forward`. Returns null if no destination has a
   * scheme we're willing to hand to a shell command at all.
   */
  private buildRunOnReady(rtmpDests: string[]): string | null {
    const validDests = rtmpDests.filter((dest) => /^rtmps?:\/\//i.test(dest));
    if (validDests.length !== rtmpDests.length) {
      this.logger.warn(
        `Dropped ${rtmpDests.length - validDests.length} forward destination(s) with an unexpected URL scheme`,
      );
    }
    if (validDests.length === 0) return null;

    const teeTargets = validDests.map((dest) => `[f=flv]${dest}`).join('|');
    return [
      'ffmpeg -nostdin -loglevel warning',
      '-i "rtsp://127.0.0.1:$RTSP_PORT/$MTX_PATH"',
      '-c:v copy -c:a aac -b:a 128k',
      `-f tee ${this.shQuote(teeTargets)}`,
    ].join(' ');
  }

  /**
   * Registers a path that accepts a WHIP publisher and forwards it to every
   * URL in rtmpDests, and returns the public WHIP URL the host's browser
   * should publish to. Best-effort: returns null (never throws) if MediaMTX
   * isn't configured, unreachable, or given no usable destinations, so a
   * MediaMTX outage degrades to "no browser-studio publish available"
   * rather than failing stream creation outright -- OBS/RTMP-direct ingest
   * doesn't depend on this at all.
   */
  async registerForward(pathName: string, rtmpDests: string[]): Promise<string | null> {
    const apiUrl = this.apiUrl;
    const whipBaseUrl = this.config.get<string>('mediamtx.whipBaseUrl');
    if (!apiUrl || !whipBaseUrl || rtmpDests.length === 0) return null;

    const runOnReady = this.buildRunOnReady(rtmpDests);
    if (!runOnReady) return null;

    try {
      await firstValueFrom(
        this.http.post(
          `${apiUrl}/v3/config/paths/add/${pathName}`,
          { source: 'publisher', runOnReady, runOnReadyRestart: true },
          this.authConfig,
        ),
      );
      return `${whipBaseUrl.replace(/\/$/, '')}/${pathName}/whip`;
    } catch (err) {
      this.logger.warn(`Failed to register MediaMTX forward path '${pathName}': ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Replaces the forward destinations on an already-registered path -- e.g.
   * after retryDestination() mints a fresh ingest URL/key for one
   * destination. Callers must pass the complete desired list, not just the
   * one entry that changed. Best-effort, same as registerForward.
   */
  async updateForward(pathName: string, rtmpDests: string[]): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    try {
      await firstValueFrom(
        this.http.patch(
          `${apiUrl}/v3/config/paths/patch/${pathName}`,
          { runOnReady: this.buildRunOnReady(rtmpDests) ?? '', runOnReadyRestart: true },
          this.authConfig,
        ),
      );
    } catch (err) {
      this.logger.warn(`Failed to update MediaMTX forward destinations for path '${pathName}': ${(err as Error).message}`);
    }
  }

  /** Best-effort: a stream ending shouldn't fail because cleanup couldn't reach MediaMTX. */
  async removeForward(pathName: string): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    try {
      await firstValueFrom(
        this.http.delete(`${apiUrl}/v3/config/paths/delete/${pathName}`, this.authConfig),
      );
    } catch (err) {
      this.logger.warn(`Failed to remove MediaMTX forward path '${pathName}': ${(err as Error).message}`);
    }
  }
}
