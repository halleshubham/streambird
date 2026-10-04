import { SessionLimitService } from './session-limit.service';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { StreamThumbnail } from './entities/stream-thumbnail.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { StreamsService } from './streams.service';
import { GlitchRecoveryService } from './glitch-recovery.service';
import { StreamSchedulingService } from './stream-scheduling.service';
import { EmailModule } from '../email/email.module';
import { StreamsController } from './streams.controller';
import { ProvidersModule } from '../providers/providers.module';
import { RelayModule } from '../relay/relay.module';
import { CommonModule } from '../common/common.module';
import { StudioModule } from '../studio/studio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LiveStream, LiveStreamDestination, PlatformConnection, StreamThumbnail]),
    ProvidersModule,
    RelayModule,
    CommonModule, // ApiKeyGuard, StreamCreateThrottlerGuard
    EmailModule,
    // Circular: StudioModule's signaling gateway calls back into
    // StreamsService.end() when a host disconnects for good (see
    // StudioSignalingGateway's doc comment on that).
    forwardRef(() => StudioModule),
  ],
  providers: [StreamsService, GlitchRecoveryService, StreamSchedulingService, SessionLimitService],
  controllers: [StreamsController],
  exports: [StreamsService, GlitchRecoveryService],
})
export class StreamsModule {}
