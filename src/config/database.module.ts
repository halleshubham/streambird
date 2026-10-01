import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Account } from '../accounts/entities/account.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { StudioSession } from '../studio/entities/studio-session.entity';
import { StudioGuestInvite } from '../studio/entities/studio-guest-invite.entity';
import { StudioParticipant } from '../studio/entities/studio-participant.entity';
import { StudioHostToken } from '../studio/entities/studio-host-token.entity';
import { User } from '../users/entities/user.entity';
import { LoginCode } from '../auth/entities/login-code.entity';
import { UserSession } from '../auth/entities/user-session.entity';
import { Company } from '../companies/entities/company.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('databaseUrl'),
        entities: [
          Account,
          PlatformConnection,
          LiveStream,
          LiveStreamDestination,
          StudioSession,
          StudioGuestInvite,
          StudioParticipant,
          StudioHostToken,
          User,
          LoginCode,
          UserSession,
          Company,
        ],
        namingStrategy: new SnakeNamingStrategy(),
        // Schema is owned by migrations/*.sql (see src/config/migrate.ts), never by TypeORM.
        synchronize: false,
        autoLoadEntities: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
