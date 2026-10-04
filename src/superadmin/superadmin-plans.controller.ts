import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountGuard } from '../common/guards/account.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { PlansService } from '../plans/plans.service';
import { CreatePlanDto, UpdatePlanDto } from '../plans/dto/plan.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Plan } from '../plans/entities/plan.entity';

/** Superadmin plan management: every limit enforced anywhere in the app is editable here. */
@Controller('superadmin/plans')
@UseGuards(AccountGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminPlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** All plans, including inactive and non-public ones. */
  @Get()
  list(): Promise<Plan[]> {
    return this.plans.list(true);
  }

  @Post()
  async create(@CurrentUser() admin: User, @Body() dto: CreatePlanDto): Promise<Plan> {
    const plan = await this.plans.create(dto);
    await this.auditLog.log(admin, 'create_plan', 'plan', null, { ...dto });
    return plan;
  }

  @Patch(':key')
  async update(@CurrentUser() admin: User, @Param('key') key: string, @Body() dto: UpdatePlanDto): Promise<Plan> {
    const before = await this.plans.findByKeyOrThrow(key);
    const snapshot = { ...before };
    const plan = await this.plans.update(key, dto);
    await this.auditLog.log(admin, 'update_plan', 'plan', null, { key, before: snapshot, changes: dto });
    return plan;
  }
}
