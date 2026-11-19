import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { ImpersonationSession } from './entities/impersonation-session.entity';
import { ImpersonationAuditInterceptor } from './impersonation-audit.interceptor';
import { ImpersonationRedactionInterceptor } from './impersonation-redaction.interceptor';
import { ImpersonationService } from './impersonation.service';

/**
 * Support sessions. Deliberately does NOT import CommonModule/AuthModule (they import this module, for
 * AccountGuard and /auth/me); the controller lives in SuperadminModule for the same reason.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ImpersonationSession, User, Account, Company]), AuditLogModule],
  providers: [
    ImpersonationService,
    { provide: APP_INTERCEPTOR, useClass: ImpersonationAuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ImpersonationRedactionInterceptor },
  ],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
