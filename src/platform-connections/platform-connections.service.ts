import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlatformConnection } from './entities/platform-connection.entity';
import { Platform } from '../common/enums/platform.enum';
import { EncryptionService } from '../encryption/encryption.service';
import { CreateManualTwitchConnectionDto } from './dto/create-manual-twitch-connection.dto';

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

  async remove(id: string, accountId: string): Promise<void> {
    const result = await this.connections.delete({ id, accountId });
    if (result.affected === 0) {
      throw new NotFoundException(`PlatformConnection ${id} not found`);
    }
  }
}
