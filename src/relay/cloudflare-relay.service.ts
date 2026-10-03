import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RelayProvider, RelayLiveInput, RelayLiveInputStatus } from './relay-provider.interface';

/**
 * RTMP-only on purpose: Cloudflare Stream Live Inputs also support WHIP
 * (WebRTC) ingest directly (confirmed current as of
 * https://developers.cloudflare.com/stream/webrtc-beta/, now GA, response
 * field is `result.webRTC.url`) — but Cloudflare's own docs are explicit
 * that "Simulcasting (restreaming via RTMP/SRT) is not supported" for a
 * WHIP-ingested Live Input, and WHIP/WHEP inputs can't be recorded or
 * played back via HLS/DASH either. That rules it out as a replacement for
 * MediaMtxService: this app's whole point is one browser publish fanning
 * out to several RTMP destinations at once, which is exactly the
 * capability Cloudflare's WHIP path doesn't have. An earlier version of
 * this class surfaced a `whipUrl` field for exactly that
 * publish-directly-to-Cloudflare idea; removed once this limitation was
 * confirmed, rather than carrying it as unused dead code indefinitely.
 */
@Injectable()
export class CloudflareRelayService implements RelayProvider {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    const accountId = this.config.get<string>('cloudflare.accountId');
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`;
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.config.get<string>('cloudflare.apiToken')}`,
    };
  }

  isConfigured(): boolean {
    return (
      !!this.config.get<string>('cloudflare.accountId') &&
      !!this.config.get<string>('cloudflare.apiToken')
    );
  }

  async createLiveInput(opts: { name: string; recording?: boolean }): Promise<RelayLiveInput> {
    const { data } = await firstValueFrom(
      this.http.post(
        this.baseUrl,
        {
          meta: { name: opts.name },
          recording: { mode: opts.recording ? 'automatic' : 'off' },
        },
        { headers: this.authHeaders },
      ),
    );

    const result = data.result;
    return {
      uid: result.uid,
      ingestUrl: result.rtmps.url,
      streamKey: result.rtmps.streamKey,
    };
  }

  async deleteLiveInput(liveInputUid: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.baseUrl}/${liveInputUid}`, { headers: this.authHeaders }),
    );
  }

  async getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus> {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/${liveInputUid}`, { headers: this.authHeaders }),
    );

    return {
      status: data.result.status?.current === 'connected' ? 'connected' : 'idle',
      outputs: data.result.outputs ?? [],
    };
  }
}
