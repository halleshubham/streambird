import {
  Controller,
  Inject,
  Logger,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StreamsService } from '../streams/streams.service';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { ConfigService } from '@nestjs/config';
import { EMAIL_SERVICE, EmailService } from '../email/email.interface';

/**
 * Superadmin-only. AccountGuard resolves the session as usual; its
 * approval gate never fires for role=SUPERADMIN (see AccountGuard), so a
 * Superadmin is always allowed through regardless. RolesGuard then
 * restricts every route here to role=SUPERADMIN specifically -- a
 * Company Admin or Normal User (even an approved one) gets a 403, and an
 * x-api-key caller (which never has a `user`/role at all) does too.
 */
@Controller('superadmin')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminController {
  private readonly logger = new Logger(SuperadminController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly auditLog: AuditLogService,
    private readonly streamsService: StreamsService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @InjectRepository(LiveStream)
    private readonly liveStreams: Repository<LiveStream>,
  ) {}

  /**
   * Every account awaiting approval -- a new Company Admin signup AND a
   * brand-new solo user's first login (see AccountGuard's approval gate,
   * UsersService.listPendingApprovals). `role` is included so the admin
   * UI can show which kind of account each row is.
   */
  @Get('pending-approvals')
  async pendingApprovals() {
    const users = await this.usersService.listPendingApprovals();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      companyName: u.account?.name ?? null,
      createdAt: u.createdAt,
    }));
  }

  @Post('users/:userId/approve')
  async approve(@CurrentUser() admin: User, @Param('userId', ParseUUIDPipe) userId: string) {
    const user = await this.usersService.approveUser(userId, admin.id);
    await this.auditLog.log(admin, 'approve_user', 'user', user.id);
    await this.notifyDecision(user.email, 'approved');
    return { id: user.id, approvedAt: user.approvedAt };
  }

  @Post('users/:userId/reject')
  @HttpCode(204)
  async reject(@CurrentUser() admin: User, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    // The account (and its email) is deleted by the rejection, so read the address first.
    const { email } = await this.usersService.findByIdOrThrow(userId);
    await this.usersService.rejectUser(userId);
    await this.auditLog.log(admin, 'reject_user', 'user', userId);
    await this.notifyDecision(email, 'rejected');
  }

  /** Tells the person the outcome. Best-effort: an email problem must never undo or fail the decision. */
  private async notifyDecision(to: string, decision: 'approved' | 'rejected'): Promise<void> {
    try {
      const baseUrl = this.config.get<string>('publicBaseUrl');
      await this.email.sendApprovalDecision(to, { decision, loginUrl: `${baseUrl}/login`, baseUrl });
    } catch (err) {
      this.logger.warn(`Could not email the ${decision} notice to ${to}: ${(err as Error).message}`);
    }
  }

  /**
   * The audit trail every other superadmin action in this feature set
   * writes to (see AuditLogService.log, and the account/user/subscription
   * controllers that call it). Newest first, paginated.
   */
  @Get('audit-log')
  async auditLogList(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const parsedLimit = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const parsedOffset = parseInt(offset ?? '0', 10) || 0;
    return this.auditLog.list(parsedLimit, parsedOffset);
  }

  /**
   * Cleanup for a stream stuck LIVE in the DB long after it actually
   * stopped -- a host whose browser closed/crashed without reconnecting
   * is now auto-ended after a minute by StudioSignalingGateway, but that
   * only covers streams going forward; this is the companion action for
   * rows already stuck from before that existed (see
   * SuperadminAnalyticsService.listLiveStreams, which this pairs with on
   * the admin UI). Reuses StreamsService.end() itself -- same destination
   * teardown and usage-hours recording a normal "End stream" click gets,
   * just resolving the account id first since a superadmin's caller
   * identity isn't the stream owner's account.
   */
  @Post('streams/:id/force-end')
  async forceEndStream(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    const stream = await this.liveStreams.findOne({ where: { id } });
    if (!stream) {
      throw new NotFoundException(`LiveStream ${id} not found`);
    }
    const ended = await this.streamsService.end(id, stream.accountId);
    await this.auditLog.log(admin, 'force_end_stream', 'live_stream', id);
    return { id: ended.id, status: ended.status, endedAt: ended.endedAt };
  }
}
