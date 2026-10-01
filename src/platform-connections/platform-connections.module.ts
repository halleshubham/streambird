import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnectionsController } from './platform-connections.controller';
import { CommonModule } from '../common/common.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // CommonModule re-exports AccountsModule too, which ApiKeyGuard needs.
  // AuthModule provides GoogleOAuthService for the YouTube connect flow.
  // LiveStreamDestination lets remove() check for stream history before
  // deciding whether a hard delete is even safe (see that method).
  imports: [
    TypeOrmModule.forFeature([PlatformConnection, LiveStreamDestination]),
    CommonModule,
    EncryptionModule,
    AuthModule,
  ],
  providers: [PlatformConnectionsService],
  controllers: [PlatformConnectionsController],
  exports: [PlatformConnectionsService],
})
export class PlatformConnectionsModule {}
