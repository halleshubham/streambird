import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuperadminAuditLogEntry } from './entities/superadmin-audit-log-entry.entity';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([SuperadminAuditLogEntry])],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
