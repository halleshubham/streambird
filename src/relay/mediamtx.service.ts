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
   * Registers a path that accepts a WHIP publisher and forwards it to every
   * URL in rtmpDests, and returns the public WHIP URL the host's browser
   * should publish to. Best-effort: returns null (never throws) if MediaMTX
   * isn't configured, unreachable, or given no destinations, so a MediaMTX
   * outage degrades to "no browser-studio publish available" rather than
   * failing stream creation outright -- OBS/RTMP-direct ingest doesn't
   * depend on this at all.
   */
  async registerForward(pathName: string, rtmpDests: string[]): Promise<string | null> {
    const apiUrl = this.apiUrl;
    const whipBaseUrl = this.config.get<string>('mediamtx.whipBaseUrl');
    if (!apiUrl || !whipBaseUrl || rtmpDests.length === 0) return null;

    try {
      await firstValueFrom(
        this.http.post(
          `${apiUrl}/v3/config/paths/add/${pathName}`,
          { source: 'publisher', forward: rtmpDests.map((dest) => ({ dest })) },
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
   * Replaces the full forward-destination list on an already-registered
   * path -- e.g. after retryDestination() mints a fresh ingest URL/key for
   * one destination. MediaMTX's patch endpoint replaces the whole `forward`
   * field wholesale, so callers must pass the complete desired list, not
   * just the one entry that changed. Best-effort, same as registerForward.
   */
  async updateForward(pathName: string, rtmpDests: string[]): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    try {
      await firstValueFrom(
        this.http.patch(
          `${apiUrl}/v3/config/paths/patch/${pathName}`,
          { forward: rtmpDests.map((dest) => ({ dest })) },
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
