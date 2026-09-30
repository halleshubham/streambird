import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConnection } from './entities/platform-connection.entity';

@Injectable()
export class PlatformConnectionsService {
  constructor(
    @InjectRepository(PlatformConnection)
    private readonly connections: Repository<PlatformConnection>,
  ) {}

  async findAllForAccount(accountId: string): Promise<PlatformConnection[]> {
    return this.connections.find({ where: { accountId, isActive: true } });
  }

  async remove(id: string, accountId: string): Promise<void> {
    const result = await this.connections.delete({ id, accountId });
    if (result.affected === 0) {
      throw new NotFoundException(`PlatformConnection ${id} not found`);
    }
  }
}
