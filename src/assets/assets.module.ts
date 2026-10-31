import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './entities/asset.entity';
import { BrandKit } from './entities/brand-kit.entity';
import { BrandKitAd } from './entities/brand-kit-ad.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AssetsService } from './assets.service';
import { BrandKitsService } from './brand-kits.service';
import { AssetsController } from './assets.controller';
import { DisabledObjectStorage, MemoryObjectStorage, OBJECT_STORAGE, R2ObjectStorage } from './object-storage';
import { AccountsModule } from '../accounts/accounts.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([Asset, BrandKit, BrandKitAd, PlatformConnection]), forwardRef(() => AccountsModule), forwardRef(() => CommonModule)],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    BrandKitsService,
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService],
      // R2 when all four settings are present; in-memory outside production (development, tests); otherwise off.
      useFactory: (config: ConfigService) => {
        const s = config.get<{ accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }>('assetStorage')!;
        if (s.accountId && s.accessKeyId && s.secretAccessKey && s.bucket) return new R2ObjectStorage(s);
        return process.env.NODE_ENV === 'production' ? new DisabledObjectStorage() : new MemoryObjectStorage();
      },
    },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
