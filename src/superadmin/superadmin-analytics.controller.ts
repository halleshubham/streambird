import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { SuperadminAnalyticsService } from './superadmin-analytics.service';

/**
 * Superadmin-only, read-only analytics (live-stream activity + usage/
 * overage alerts). Same AccountGuard/RolesGuard pattern as
 * SuperadminController -- kept in a separate controller/file so this
 * lands without touching that file's body (see its own docstring for why
 * that split matters right now). No mutations here, so (unlike
 * SuperadminController) there's nothing to send to AuditLogService.
 */
@Controller('superadmin/analytics')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminAnalyticsController {
  constructor(private readonly analytics: SuperadminAnalyticsService) {}

  @Get('overview')
  overview() {
    return this.analytics.getOverview();
  }

  @Get('usage-alerts')
  usageAlerts() {
    return this.analytics.getUsageAlerts();
  }

  @Get('live-streams')
  liveStreams() {
    return this.analytics.listLiveStreams();
  }
}
