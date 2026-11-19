import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudioSession } from './entities/studio-session.entity';
import { StudioGuestInvite } from './entities/studio-guest-invite.entity';
import { StudioParticipant } from './entities/studio-participant.entity';
import { StudioHostToken } from './entities/studio-host-token.entity';
import { StudioSessionsService } from './studio-sessions.service';
import { StudioSessionsController } from './studio-sessions.controller';
import { StudioSignalingGateway } from './studio-signaling.gateway';
import { TurnCredentialsService } from './turn-credentials.service';
import { SupportControlController } from './support/support-control.controller';
import { SupportControlService } from './support/support-control.service';
import { BrandKit } from '../assets/entities/brand-kit.entity';
import { ImpersonationModule } from '../impersonation/impersonation.module';
import { CommonModule } from '../common/common.module';
import { StreamsModule } from '../streams/streams.module';

@Module({
  // CommonModule re-exports AccountsModule too, which ApiKeyGuard and the
  // signaling gateway both need for AccountsService.
  imports: [
    TypeOrmModule.forFeature([
      StudioSession,
      StudioGuestInvite,
      StudioParticipant,
      StudioHostToken,
      BrandKit,
    ]),
    ImpersonationModule,
    CommonModule,
    // Circular: see StreamsModule's own forwardRef back to this module.
    forwardRef(() => StreamsModule),
  ],
  providers: [StudioSessionsService, StudioSignalingGateway, TurnCredentialsService, SupportControlService],
  controllers: [StudioSessionsController, SupportControlController],
  exports: [StudioSessionsService],
})
export class StudioModule {}
