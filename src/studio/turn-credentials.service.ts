import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Generous enough to cover a long stream plus reconnects without needing
// mid-session renewal; short enough to cap the blast radius if these ever
// leaked (unlike the raw API token, which never leaves this service).
const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;
// Refreshed well before Cloudflare's own TTL expires, and shared across
// every concurrent studio session in this window rather than minting a
// fresh credential per page load -- these aren't single-use.
const CACHE_MS = 3 * 60 * 60 * 1000;
const FALLBACK_STUN: IceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * The host<->guest WebRTC mesh was STUN-only, which silently fails to
 * ever carry media for a guest behind a NAT/firewall STUN alone can't
 * traverse -- confirmed live via StudioSignalingGateway's rtc-state
 * diagnostics (ICE went checking -> disconnected -> failed, never
 * connected). Cloudflare Calls TURN fixes that, but the API token used to
 * mint credentials must never reach a browser -- it can mint arbitrary
 * TURN credentials against the account on its own. Only the short-lived
 * generated credentials this service hands back (via
 * StudioSessionsController's public turn-credentials endpoint) are safe
 * to ship to a client.
 */
@Injectable()
export class TurnCredentialsService {
  private readonly logger = new Logger(TurnCredentialsService.name);
  private cached: { iceServers: IceServerConfig[]; fetchedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  async getIceServers(): Promise<IceServerConfig[]> {
    const tokenId = this.config.get<string>('cloudflareTurn.tokenId');
    const apiToken = this.config.get<string>('cloudflareTurn.apiToken');
    if (!tokenId || !apiToken) {
      return FALLBACK_STUN;
    }

    if (this.cached && Date.now() - this.cached.fetchedAt < CACHE_MS) {
      return this.cached.iceServers;
    }

    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        },
      );
      if (!res.ok) {
        throw new Error(`Cloudflare TURN credential generation failed (${res.status}): ${await res.text()}`);
      }
      const body = (await res.json()) as { iceServers: IceServerConfig[] };
      this.cached = { iceServers: body.iceServers, fetchedAt: Date.now() };
      return body.iceServers;
    } catch (err) {
      this.logger.error(`Failed to fetch TURN credentials, falling back to cache/STUN: ${(err as Error).message}`);
      // A stale-but-still-valid cached credential beats dropping to
      // STUN-only just because one refresh call had a blip.
      return this.cached?.iceServers ?? FALLBACK_STUN;
    }
  }
}
