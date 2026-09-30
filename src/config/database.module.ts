import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Account } from '../accounts/entities/account.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('databaseUrl'),
        entities: [Account, PlatformConnection, LiveStream, LiveStreamDestination],
        namingStrategy: new SnakeNamingStrategy(),
        // Schema is owned by migrations/*.sql (see src/config/migrate.ts), never by TypeORM.
        synchronize: false,
        autoLoadEntities: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
