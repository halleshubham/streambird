import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudioSession } from './entities/studio-session.entity';
import { StudioGuestInvite } from './entities/studio-guest-invite.entity';
import { StudioParticipant } from './entities/studio-participant.entity';
import { StudioSessionsService } from './studio-sessions.service';
import { StudioSessionsController } from './studio-sessions.controller';
import { StudioSignalingGateway } from './studio-signaling.gateway';
import { CommonModule } from '../common/common.module';

@Module({
  // CommonModule re-exports AccountsModule too, which ApiKeyGuard and the
  // signaling gateway both need for AccountsService.
  imports: [
    TypeOrmModule.forFeature([StudioSession, StudioGuestInvite, StudioParticipant]),
    CommonModule,
  ],
  providers: [StudioSessionsService, StudioSignalingGateway],
  controllers: [StudioSessionsController],
  exports: [StudioSessionsService],
})
export class StudioModule {}
