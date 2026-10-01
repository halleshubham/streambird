import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuperadminAuditLogEntry } from './entities/superadmin-audit-log-entry.entity';
import { User } from '../users/entities/user.entity';

/**
 * Every mutating superadmin action (account/user directory edits,
 * suspend/reactivate, subscription changes, approve/reject) should call
 * this -- see SuperadminController's various action methods. Logging
 * failures are swallowed rather than thrown: an audit-log write must
 * never be the reason a legitimate superadmin action itself fails.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(SuperadminAuditLogEntry)
    private readonly entries: Repository<SuperadminAuditLogEntry>,
  ) {}

  async log(
    actor: User,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.entries.save(
        this.entries.create({
          actorUserId: actor.id,
          action,
          targetType,
          targetId,
          metadata: metadata ?? null,
        }),
      );
    } catch {
      // Deliberately swallowed -- see class docstring.
    }
  }

  async list(limit: number, offset: number): Promise<SuperadminAuditLogEntry[]> {
    return this.entries.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
