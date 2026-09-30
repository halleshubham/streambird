import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RelayProvider, RelayLiveInput, RelayLiveInputStatus } from './relay-provider.interface';

// Mux's RTMP(S) ingest endpoint is the same fixed URL for every account --
// only the per-live-stream stream_key varies (unlike Cloudflare, which
// mints a distinct ingest hostname per Live Input).
const MUX_RTMP_INGEST_URL = 'rtmps://global-live.mux.com:443/app';

/**
 * Swappable alternative to CloudflareRelayService, for failing over the
 * managed relay/simulcast layer during a Cloudflare outage without a code
 * change -- see RelayModule, which picks the active provider from config.
 *
 * One real capability gap versus Cloudflare: Mux's live ingest is RTMP/SRT
 * only as of this writing, with no WHIP (WebRTC) publish endpoint. So
 * whipUrl is always null here -- a Mux-backed stream works for the OBS/RTMP
 * ingest fallback, but the browser-based host studio (which publishes via
 * WHIP) has nothing to publish to until Mux ships WHIP ingest, if ever.
 *
 * TODO(empirical-spike): the response field names below (result.id,
 * result.stream_key, result.status, simulcast_targets[].status) match Mux's
 * documented Video API shape but haven't been verified against a real Mux
 * account/live stream yet -- confirm against a live create-live-stream
 * response before relying on this as the active provider in production
 * (same caveat CloudflareRelayService already carries for its own
 * unverified whipUrl field).
 */
@Injectable()
export class MuxRelayService implements RelayProvider {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private readonly baseUrl = 'https://api.mux.com/video/v1/live-streams';

  private get authConfig() {
    return {
      auth: {
        username: this.config.get<string>('mux.tokenId')!,
        password: this.config.get<string>('mux.tokenSecret')!,
      },
    };
  }

  isConfigured(): boolean {
    return (
      !!this.config.get<string>('mux.tokenId') && !!this.config.get<string>('mux.tokenSecret')
    );
  }

  async createLiveInput(opts: { name: string; recording?: boolean }): Promise<RelayLiveInput> {
    const { data } = await firstValueFrom(
      this.http.post(
        this.baseUrl,
        {
          playback_policy: ['public'],
          reconnect_window: 60,
          // Mux always keeps the source recording as a VOD asset unless
          // told not to -- opts.recording === false turns that off so a
          // stream that never asked for recording doesn't silently get one.
          ...(opts.recording === false ? { new_asset_settings: { playback_policy: [] } } : {}),
          passthrough: opts.name,
        },
        this.authConfig,
      ),
    );

    const result = data.data;
    return {
      uid: result.id,
      ingestUrl: MUX_RTMP_INGEST_URL,
      streamKey: result.stream_key,
      whipUrl: null,
    };
  }

  async deleteLiveInput(liveInputUid: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.baseUrl}/${liveInputUid}`, this.authConfig));
  }

  async getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus> {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/${liveInputUid}`, this.authConfig),
    );

    const result = data.data;
    return {
      status: result.status === 'active' ? 'connected' : 'idle',
      outputs: (result.simulcast_targets ?? []).map((t: { id: string; status: string }) => ({
        uid: t.id,
        status: t.status,
      })),
    };
  }
}
