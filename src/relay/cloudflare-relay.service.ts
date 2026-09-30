import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  RelayProvider,
  RelayLiveInput,
  RelayLiveInputStatus,
  RelayOutput,
} from './relay-provider.interface';

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
      // TODO(empirical-spike): confirm this field name against a real
      // Cloudflare Live Input response before relying on it in production —
      // this matches Cloudflare's documented WHIP publish URL shape
      // (result.webRTC.url) but hasn't been verified against a live account
      // yet (see the implementation plan's Build Order step 3).
      whipUrl: result.webRTC?.url ?? null,
    };
  }

  async addOutput(
    liveInputUid: string,
    dest: { url: string; streamKey: string },
  ): Promise<RelayOutput> {
    const { data } = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/${liveInputUid}/outputs`,
        { url: dest.url, streamKey: dest.streamKey, enabled: true },
        { headers: this.authHeaders },
      ),
    );

    return { uid: data.result.uid, url: dest.url, streamKey: dest.streamKey };
  }

  async removeOutput(liveInputUid: string, outputUid: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.baseUrl}/${liveInputUid}/outputs/${outputUid}`, {
        headers: this.authHeaders,
      }),
    );
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
