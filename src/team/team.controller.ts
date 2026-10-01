import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TeamService } from './team.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

/**
 * Company Admin's own team management -- add/remove Normal Users into
 * THEIR OWN company only. AccountGuard resolves the caller's account as
 * usual (and rejects an unapproved Company Admin outright, before this
 * controller ever runs -- see AccountGuard's approval gate); RolesGuard
 * then further restricts every route here to role=COMPANY_ADMIN, so a
 * Normal User (who "cannot manage other users" per spec) gets a 403.
 */
@Controller('team')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.COMPANY_ADMIN)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  async list(@CurrentAccount() account: Account) {
    const users = await this.teamService.list(account.id);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }));
  }

  @Post('invite')
  async invite(@CurrentAccount() account: Account, @Body() dto: InviteUserDto) {
    const user = await this.teamService.invite(account, dto.email);
    return { id: user.id, email: user.email, role: user.role };
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(
    @CurrentAccount() account: Account,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.teamService.remove(account.id, userId);
  }
}
