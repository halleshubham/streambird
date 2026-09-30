import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Platform } from '../../common/enums/platform.enum';
import { EncryptionService } from '../../encryption/encryption.service';
import { PlatformConnection } from '../../platform-connections/entities/platform-connection.entity';
import { BroadcastMeta, BroadcastResult, StreamProvider } from '../stream-provider.interface';

interface TwitchCredentials {
  accessToken: string;
  refreshToken: string;
  ingestServerUrl: string;
  streamKey: string;
}

/**
 * Twitch has no "create broadcast" API — the ingest URL/key are a static
 * pair captured from the connected account at OAuth-connect time. This
 * adapter therefore does zero network I/O in createBroadcast, which keeps
 * the StreamProvider interface honest without special-casing Twitch
 * anywhere in orchestration code.
 */
@Injectable()
export class TwitchProvider implements StreamProvider {
  readonly identifier = Platform.TWITCH;

  constructor(
    private readonly encryption: EncryptionService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async createBroadcast(
    conn: PlatformConnection,
    _meta: BroadcastMeta,
  ): Promise<BroadcastResult> {
    const creds = this.encryption.decrypt<TwitchCredentials>(conn.credentialsCiphertext);
    return {
      ingestUrl: creds.ingestServerUrl,
      streamKey: creds.streamKey,
      // Twitch has no broadcast object; the channel id is the stable handle.
      platformBroadcastId: conn.externalAccountId,
    };
  }

  async endBroadcast(_conn: PlatformConnection, _platformBroadcastId: string): Promise<void> {
    // No-op: the Twitch stream ends automatically when the RTMP input
    // stops. There is nothing platform-side to tear down.
  }

  async getViewerCount(conn: PlatformConnection, _platformBroadcastId: string): Promise<number> {
    const creds = this.encryption.decrypt<TwitchCredentials>(conn.credentialsCiphertext);
    const clientId = this.config.get<string>('twitchClientId');

    const response = await firstValueFrom(
      this.http.get('https://api.twitch.tv/helix/streams', {
        params: { user_id: conn.externalAccountId },
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Client-Id': clientId,
        },
      }),
    );

    return response.data?.data?.[0]?.viewer_count ?? 0;
  }
}
