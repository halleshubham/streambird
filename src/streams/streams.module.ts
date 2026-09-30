import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveStream } from './entities/live-stream.entity';
import { LiveStreamDestination } from './entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { StreamsService } from './streams.service';
import { StreamsController } from './streams.controller';
import { ProvidersModule } from '../providers/providers.module';
import { RelayModule } from '../relay/relay.module';
import { CommonModule } from '../common/common.module';
import { StudioModule } from '../studio/studio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LiveStream, LiveStreamDestination, PlatformConnection]),
    ProvidersModule,
    RelayModule,
    CommonModule, // ApiKeyGuard, StreamCreateThrottlerGuard
    StudioModule,
  ],
  providers: [StreamsService],
  controllers: [StreamsController],
})
export class StreamsModule {}
