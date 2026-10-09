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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { StudioSessionsService } from './studio-sessions.service';
import { TurnCredentialsService } from './turn-credentials.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CheckInvitePasswordDto } from './dto/check-invite-password.dto';
import { UpdateLayoutDto } from './dto/update-layout.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

@Controller('studio-sessions')
export class StudioSessionsController {
  constructor(
    private readonly studioSessionsService: StudioSessionsService,
    private readonly turnCredentials: TurnCredentialsService,
  ) {}

  /**
   * Public, like invites/:token below -- both host and guest need this
   * before/while negotiating WebRTC, and they authenticate completely
   * differently (account session vs. invite token), so this just isn't
   * gated by either. Nothing sensitive crosses this boundary: the
   * Cloudflare API token that can mint these never leaves
   * TurnCredentialsService, only the short-lived result does. Throttled
   * per-IP since it's unauthenticated and calls out to a paid third-party
   * API on a cache miss.
   */
  @Get('turn-credentials')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async turnCredentialsEndpoint() {
    return { iceServers: await this.turnCredentials.getIceServers() };
  }

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
      passwordRequired: !!invite.passwordHash,
    };
  }

  /**
   * Public. Checks a guest's invite password before they enter the room, so a wrong one is
   * refused on the join form. Throttled per IP because it is an unauthenticated password check.
   */
  @Post('invites/:token/check-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async checkInvitePassword(@Param('token') token: string, @Body() dto: CheckInvitePasswordDto): Promise<void> {
    await this.studioSessionsService.checkInvitePassword(token, dto.password);
  }

  /**
   * Mints the reusable socket-auth token the studio host page uses instead
   * of sending the account's real API key into the browser's Socket.IO
   * handshake. See StudioSessionsService.mintHostToken.
   */
  @Post(':id/host-token')
  @UseGuards(AccountGuard)
  async mintHostToken(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studioSessionsService.mintHostToken(id, account.id);
  }

  @Post(':id/invites')
  @UseGuards(AccountGuard)
  async createInvite(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.studioSessionsService.createInvite(id, account.id, dto);
  }

  @Delete(':id/invites/:inviteId')
  @UseGuards(AccountGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    await this.studioSessionsService.revokeInvite(id, inviteId, account.id);
  }

  @Get(':id/participants')
  @UseGuards(AccountGuard)
  async listParticipants(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studioSessionsService.listParticipants(id, account.id);
  }

  @Patch(':id/layout')
  @UseGuards(AccountGuard)
  async updateLayout(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLayoutDto,
  ) {
    const session = await this.studioSessionsService.updateLayout(id, account.id, dto.layoutConfig);
    return { id: session.id, layoutConfig: session.layoutConfig };
  }
}
