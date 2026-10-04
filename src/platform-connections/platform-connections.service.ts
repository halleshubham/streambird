import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { Platform } from '../common/enums/platform.enum';
import { EncryptionService } from '../encryption/encryption.service';
import { GoogleOAuthService } from '../auth/google-oauth.service';
import { CreateManualTwitchConnectionDto } from './dto/create-manual-twitch-connection.dto';
import type { YouTubeCredentials } from '../providers/youtube/youtube.provider';
import type { FacebookCredentials } from '../providers/facebook/facebook.provider';

interface TwitchCredentials {
  accessToken: string;
  refreshToken: string;
  ingestServerUrl: string;
  streamKey: string;
}

@Injectable()
export class PlatformConnectionsService {
  private readonly logger = new Logger(PlatformConnectionsService.name);

  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
    @InjectRepository(LiveStreamDestination)
    private readonly destinations: Repository<LiveStreamDestination>,
    private readonly encryption: EncryptionService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  async findAllForAccount(accountId: string): Promise<PlatformConnection[]> {
    return this.connections.find({ where: { accountId, isActive: true } });
  }

  async createManualTwitchConnection(
    accountId: string,
    dto: CreateManualTwitchConnectionDto,
  ): Promise<PlatformConnection> {
    const credentials: TwitchCredentials = {
      accessToken: '', // no OAuth token for the manual path — getViewerCount degrades gracefully without one
      refreshToken: '',
      ingestServerUrl: dto.ingestServerUrl,
      streamKey: dto.streamKey,
    };

    const connection = this.connections.create({
      accountId,
      platform: Platform.TWITCH,
      credentialsCiphertext: this.encryption.encrypt(credentials),
      // No OAuth means no real Twitch channel id to key on; a random id
      // keeps the (account, platform, externalAccountId) uniqueness
      // constraint meaningful without pretending we have one.
      externalAccountId: crypto.randomUUID(),
      label: dto.label,
    });

    return this.connections.save(connection);
  }

  /**
   * Called by PlatformConnectionsController's YouTube OAuth callback.
   * Upserts on (accountId, platform, channelId) rather than always
   * inserting -- reconnecting the same YouTube channel (e.g. after
   * revoking access, or just to refresh the granted scopes) should update
   * the existing row's tokens in place, not pile up duplicate
   * connections for the same channel.
   */
  async upsertYouTubeConnection(
    accountId: string,
    channel: { channelId: string; channelTitle: string },
    tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  ): Promise<PlatformConnection> {
    const credentials: YouTubeCredentials = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      channelId: channel.channelId,
    };

    const existing = await this.connections.findOne({
      where: { accountId, platform: Platform.YOUTUBE, externalAccountId: channel.channelId },
    });

    if (existing) {
      existing.credentialsCiphertext = this.encryption.encrypt(credentials);
      existing.label = channel.channelTitle;
      existing.isActive = true;
      return this.connections.save(existing);
    }

    const connection = this.connections.create({
      accountId,
      platform: Platform.YOUTUBE,
      credentialsCiphertext: this.encryption.encrypt(credentials),
      externalAccountId: channel.channelId,
      label: channel.channelTitle,
    });
    return this.connections.save(connection);
  }

  /**
   * Called by PlatformConnectionsController's Facebook OAuth callback (or
   * its page-select step, when the user manages more than one Page).
   * Upserts on (accountId, platform, pageId) for the same reason
   * upsertYouTubeConnection upserts on channelId -- reconnecting the same
   * Page should refresh its stored token in place, not create a duplicate.
   */
  async upsertFacebookConnection(
    accountId: string,
    page: { pageId: string; pageName: string },
    pageAccessToken: string,
  ): Promise<PlatformConnection> {
    const credentials: FacebookCredentials = { pageAccessToken, pageId: page.pageId };

    const existing = await this.connections.findOne({
      where: { accountId, platform: Platform.FACEBOOK, externalAccountId: page.pageId },
    });

    if (existing) {
      existing.credentialsCiphertext = this.encryption.encrypt(credentials);
      existing.label = page.pageName;
      existing.isActive = true;
      return this.connections.save(existing);
    }

    const connection = this.connections.create({
      accountId,
      platform: Platform.FACEBOOK,
      credentialsCiphertext: this.encryption.encrypt(credentials),
      externalAccountId: page.pageId,
      label: page.pageName,
    });
    return this.connections.save(connection);
  }

  /**
   * Disconnects a platform. Whatever happens to the row, the credentials
   * stop existing: a YouTube refresh token is revoked at Google (so our
   * access really ends, not just our copy of the token) and the stored
   * ciphertext is wiped.
   *
   * A connection referenced by any live_stream_destinations row can't be
   * hard-deleted -- that FK is ON DELETE RESTRICT by design (stream
   * history must survive a connection being removed later), and
   * previously this just let Postgres's raw constraint-violation error
   * surface as an unhandled 500 instead of a clean response. If the
   * connection has any stream history, deactivate it instead (consistent
   * with the existing isActive flag findAllForAccount already filters
   * on) -- it disappears from the account's active connections exactly
   * like a real delete would, without breaking past streams' records --
   * but with its credentials blanked, so no token outlives the disconnect.
   * Only a connection that was NEVER actually used is hard-deleted.
   */
  async remove(id: string, accountId: string): Promise<void> {
    const connection = await this.connections.findOne({ where: { id, accountId } });
    if (!connection) {
      throw new NotFoundException(`PlatformConnection ${id} not found`);
    }

    await this.revokeAtProvider(connection);

    const usedByAStream = await this.destinations.count({ where: { platformConnectionId: id } });
    if (usedByAStream > 0) {
      connection.isActive = false;
      // An empty blob can never decrypt (EncryptionService rejects it as too
      // short), so nothing can accidentally use this connection again; a
      // reconnect overwrites it with fresh credentials.
      connection.credentialsCiphertext = Buffer.alloc(0);
      await this.connections.save(connection);
      return;
    }

    await this.connections.delete({ id, accountId });
  }

  /**
   * Ends our access at the provider where an API exists to do that.
   * Best-effort: a failure is logged and never blocks the disconnect -- the
   * stored credentials are wiped regardless, and the user can still revoke
   * StreamBird in their Google account settings.
   *
   * - YouTube: revoke the refresh token at Google -- unless another active
   *   connection stores the very same token (revoking it would silently
   *   break that one too).
   * - Facebook: only a Page access token is stored (no user token), and Meta
   *   offers no way to revoke a Page token alone; wiping our copy is all we
   *   can do. The user can remove StreamBird under Facebook's Business
   *   Integrations settings.
   * - Twitch: a manually pasted stream key, nothing to revoke.
   */
  private async revokeAtProvider(connection: PlatformConnection): Promise<void> {
    if (connection.platform !== Platform.YOUTUBE || connection.credentialsCiphertext.length === 0) return;

    let refreshToken: string | undefined;
    try {
      refreshToken = this.encryption.decrypt<YouTubeCredentials>(connection.credentialsCiphertext).refreshToken;
    } catch (err) {
      this.logger.warn(`Could not read the YouTube credentials of connection ${connection.id} to revoke them: ${(err as Error).message}`);
      return;
    }
    if (!refreshToken) return;

    if (await this.refreshTokenUsedElsewhere(connection.id, refreshToken)) {
      this.logger.log(`Not revoking the Google token of connection ${connection.id}: another active connection uses the same token`);
      return;
    }

    try {
      await this.googleOAuth.revokeToken(refreshToken);
    } catch (err) {
      this.logger.warn(`Revoking the Google token of connection ${connection.id} failed: ${(err as Error).message}`);
    }
  }

  private async refreshTokenUsedElsewhere(connectionId: string, refreshToken: string): Promise<boolean> {
    const others = await this.connections.find({ where: { platform: Platform.YOUTUBE, isActive: true } });
    return others.some((other) => {
      if (other.id === connectionId || other.credentialsCiphertext.length === 0) return false;
      try {
        return this.encryption.decrypt<YouTubeCredentials>(other.credentialsCiphertext).refreshToken === refreshToken;
      } catch {
        return false;
      }
    });
  }
}
