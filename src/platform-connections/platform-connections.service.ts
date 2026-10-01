import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { Platform } from '../common/enums/platform.enum';
import { EncryptionService } from '../encryption/encryption.service';
import { CreateManualTwitchConnectionDto } from './dto/create-manual-twitch-connection.dto';
import type { YouTubeCredentials } from '../providers/youtube/youtube.provider';

interface TwitchCredentials {
  accessToken: string;
  refreshToken: string;
  ingestServerUrl: string;
  streamKey: string;
}

@Injectable()
export class PlatformConnectionsService {
  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
    @InjectRepository(LiveStreamDestination)
    private readonly destinations: Repository<LiveStreamDestination>,
    private readonly encryption: EncryptionService,
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
   * A connection referenced by any live_stream_destinations row can't be
   * hard-deleted -- that FK is ON DELETE RESTRICT by design (stream
   * history must survive a connection being removed later), and
   * previously this just let Postgres's raw constraint-violation error
   * surface as an unhandled 500 instead of a clean response. If the
   * connection has any stream history, deactivate it instead (consistent
   * with the existing isActive flag findAllForAccount already filters
   * on) -- it disappears from the account's active connections exactly
   * like a real delete would, without breaking past streams' records.
   * Only a connection that was NEVER actually used is hard-deleted.
   */
  async remove(id: string, accountId: string): Promise<void> {
    const connection = await this.connections.findOne({ where: { id, accountId } });
    if (!connection) {
      throw new NotFoundException(`PlatformConnection ${id} not found`);
    }

    const usedByAStream = await this.destinations.count({ where: { platformConnectionId: id } });
    if (usedByAStream > 0) {
      connection.isActive = false;
      await this.connections.save(connection);
      return;
    }

    await this.connections.delete({ id, accountId });
  }
}
