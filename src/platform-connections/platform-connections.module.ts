import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConnection } from './entities/platform-connection.entity';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnectionsController } from './platform-connections.controller';
import { CommonModule } from '../common/common.module';
import { EncryptionModule } from '../encryption/encryption.module';

@Module({
  // CommonModule re-exports AccountsModule too, which ApiKeyGuard needs.
  imports: [TypeOrmModule.forFeature([PlatformConnection]), CommonModule, EncryptionModule],
  providers: [PlatformConnectionsService],
  controllers: [PlatformConnectionsController],
  exports: [PlatformConnectionsService],
})
export class PlatformConnectionsModule {}
