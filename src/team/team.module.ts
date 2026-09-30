import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';

@Module({
  imports: [UsersModule, CommonModule, EmailModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
