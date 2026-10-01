import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlatformConnection } from './entities/platform-connection.entity';
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

  async remove(id: string, accountId: string): Promise<void> {
    const result = await this.connections.delete({ id, accountId });
    if (result.affected === 0) {
      throw new NotFoundException(`PlatformConnection ${id} not found`);
    }
  }
}
