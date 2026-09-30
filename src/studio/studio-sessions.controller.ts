import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StudioSessionsService } from './studio-sessions.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { UpdateLayoutDto } from './dto/update-layout.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

@Controller('studio-sessions')
export class StudioSessionsController {
  constructor(private readonly studioSessionsService: StudioSessionsService) {}

  /**
   * Public — no API key. The guest join page (web/guest.html) calls this
   * to validate an invite token and surface a friendly error before ever
   * requesting camera/mic permission, without needing the host's account
   * credentials.
   */
  @Get('invites/:token')
  async resolveInvite(@Param('token') token: string) {
    const invite = await this.studioSessionsService.resolveInviteToken(token);
    return {
      studioSessionId: invite.studioSessionId,
      label: invite.label,
      expiresAt: invite.expiresAt,
    };
  }

  @Post(':id/invites')
  @UseGuards(ApiKeyGuard)
  async createInvite(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.studioSessionsService.createInvite(id, account.id, dto);
  }

  @Delete(':id/invites/:inviteId')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    await this.studioSessionsService.revokeInvite(id, inviteId, account.id);
  }

  @Get(':id/participants')
  @UseGuards(ApiKeyGuard)
  async listParticipants(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studioSessionsService.listParticipants(id, account.id);
  }

  @Patch(':id/layout')
  @UseGuards(ApiKeyGuard)
  async updateLayout(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLayoutDto,
  ) {
    const session = await this.studioSessionsService.updateLayout(id, account.id, dto.layoutConfig);
    return { id: session.id, layoutConfig: session.layoutConfig };
  }
}
