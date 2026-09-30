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
 * at all. So instead of publishing WHIP directly to whichever RelayProvider
 * is active, the host's browser always publishes WHIP to this MediaMTX
 * instance, which immediately forwards the same stream onward as RTMP to
 * that provider's real ingest URL -- the provider then sees a normal
 * RTMP-sourced live input, which is the path that actually works.
 *
 * Each LiveStream gets its own MediaMTX path (named after the stream's own
 * id), registered/removed at runtime via MediaMTX's Control API rather
 * than static config, since the RTMP forward destination (provider ingest
 * URL + per-stream key) is only known once StreamsService.create() has
 * already created the live input.
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
   * Registers a path that accepts a WHIP publisher and forwards it to
   * rtmpDest, and returns the public WHIP URL the host's browser should
   * publish to. Best-effort: returns null (never throws) if MediaMTX isn't
   * configured or unreachable, so a MediaMTX outage degrades to "no
   * browser-studio publish available" rather than failing stream creation
   * outright -- OBS/RTMP-direct ingest doesn't depend on this at all.
   */
  async registerForward(pathName: string, rtmpDest: string): Promise<string | null> {
    const apiUrl = this.apiUrl;
    const whipBaseUrl = this.config.get<string>('mediamtx.whipBaseUrl');
    if (!apiUrl || !whipBaseUrl) return null;

    try {
      await firstValueFrom(
        this.http.post(
          `${apiUrl}/v3/config/paths/add/${pathName}`,
          { source: 'publisher', forward: [{ dest: rtmpDest }] },
          this.authConfig,
        ),
      );
      return `${whipBaseUrl.replace(/\/$/, '')}/${pathName}/whip`;
    } catch (err) {
      this.logger.warn(`Failed to register MediaMTX forward path '${pathName}': ${(err as Error).message}`);
      return null;
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
