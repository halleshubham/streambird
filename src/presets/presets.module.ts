import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StreamPreset } from './entities/stream-preset.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { BrandKit } from '../assets/entities/brand-kit.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';
import { StreamsModule } from '../streams/streams.module';
import { PresetsController } from './presets.controller';
import { PresetsService } from './presets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StreamPreset, PlatformConnection, BrandKit]),
    forwardRef(() => AccountsModule),
    forwardRef(() => CommonModule),
    StreamsModule,
  ],
  controllers: [PresetsController],
  providers: [PresetsService],
})
export class PresetsModule {}
