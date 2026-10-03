import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { AccountsService } from '../accounts/accounts.service';
import { Role } from '../common/enums/role.enum';

// Minimal stand-in for TypeORM's FindOperator (e.g. IsNull(), ILike(), In())
// so these fakes can support the same `where` shapes the real repo accepts.
function matchesWhere(row: any, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, val]) => {
    if (val instanceof FindOperator) {
      if (val.type === 'isNull') return row[k] == null;
      if (val.type === 'ilike') {
        const pattern = String(val.value).replace(/%/g, '').toLowerCase();
        return typeof row[k] === 'string' && row[k].toLowerCase().includes(pattern);
      }
      if (val.type === 'in') {
        return (val.value as unknown[]).includes(row[k]);
      }
      return true;
    }
    return row[k] === val;
  });
}

function inMemoryRepo<T extends { id?: string }>(prefix: string) {
  const rows = new Map<string, T>();
  let counter = 0;
  return {
    rows,
    create: jest.fn((v: Partial<T>) => ({ ...v }) as T),
    save: jest.fn(async (v: T) => {
      if (!v.id) v.id = `${prefix}_${++counter}`;
      rows.set(v.id, v);
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      const match = [...rows.values()].find((r: any) => matchesWhere(r, where));
      return match ?? null;
    }),
    find: jest.fn(async ({ where, take }: any = {}) => {
      const matched = [...rows.values()]
        .filter((r: any) => matchesWhere(r, where ?? {}))
        .sort((a: any, b: any) => a.createdAt?.getTime() - b.createdAt?.getTime());
      return typeof take === 'number' ? matched.slice(0, take) : matched;
    }),
    delete: jest.fn(async (id: string) => {
      rows.delete(id);
      return { affected: 1 };
    }),
  };
}

describe('UsersService', () => {
  async function build() {
    const users = inMemoryRepo<User>('user');
    const companies = inMemoryRepo<Company>('company');
    let accountCounter = 0;
    const accountsService = {
      create: jest.fn(async ({ name }: { name: string }) => {
        const account = { id: `acc_${++accountCounter}`, name };
        return { account, apiKey: 'sb_fake' };
      }),
      remove: jest.fn(async (_accountId: string) => undefined),
    };

    // createdAt is needed for find()'s sort -- the real repo's column
    // default sets it; this fake doesn't, so set it explicitly on create.
    users.create.mockImplementation(
      (v: Partial<User>) => ({ createdAt: new Date(), ...v }) as User,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Company), useValue: companies },
        { provide: AccountsService, useValue: accountsService },
      ],
    }).compile();

    return { service: moduleRef.get(UsersService), users, companies, accountsService };
  }

  it('creates exactly one Account+User pair on first-ever login for an email, pending approval', async () => {
    const { service, accountsService } = await build();

    const { user, account } = await service.findOrCreateForEmail('New@Example.com');

    expect(accountsService.create).toHaveBeenCalledTimes(1);
    expect(user.email).toBe('New@Example.com');
    expect(user.accountId).toBe(account.id);
    expect(user.role).toBe(Role.USER);
    // A brand-new solo signup is gated by the Superadmin approval queue
    // exactly like a new Company Admin signup -- see AccountGuard.
    expect(user.approvedAt).toBeNull();
  });

  it('a returning email resolves the same User/Account instead of creating a new pair', async () => {
    const { service, accountsService, users } = await build();

    const first = await service.findOrCreateForEmail('repeat@example.com');
    // Simulate the real repo's relations:['account'] join for the second lookup.
    users.rows.get(first.user.id)!.account = first.account as any;

    const second = await service.findOrCreateForEmail('repeat@example.com');

    expect(accountsService.create).toHaveBeenCalledTimes(1);
    expect(second.user.id).toBe(first.user.id);
    expect(second.account.id).toBe(first.account.id);
  });

  it('createCompanyAdmin creates a Company + Account + unapproved company_admin User', async () => {
    const { service, companies } = await build();

    const { user, account, company } = await service.createCompanyAdmin(
      'Acme Inc',
      'admin@acme.com',
    );

    expect(user.role).toBe(Role.COMPANY_ADMIN);
    expect(user.approvedAt).toBeNull();
    expect(user.accountId).toBe(account.id);
    expect(company.accountId).toBe(account.id);
    expect(companies.rows.size).toBe(1);
  });

  it('createCompanyAdmin refuses to create a second company for an already-registered email', async () => {
    const { service } = await build();
    await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');

    await expect(service.createCompanyAdmin('Other Co', 'admin@acme.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('convertToCompanyAccount', () => {
    it('promotes a solo user to company_admin, attaches a new Company, and preserves their existing approvedAt', async () => {
      const { service, users, companies } = await build();
      const { user } = await service.findOrCreateForEmail('solo@example.com');
      user.approvedAt = new Date('2026-01-01T00:00:00Z');
      await users.save(user);

      const result = await service.convertToCompanyAccount(user.id!, 'Solo Co');

      expect(result.user.role).toBe(Role.COMPANY_ADMIN);
      expect(result.user.approvedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(result.company.name).toBe('Solo Co');
      expect(result.company.accountId).toBe(user.accountId);
      expect(companies.rows.size).toBe(1);
    });

    it('refuses to convert a user who is already company_admin or superadmin', async () => {
      const { service } = await build();
      const { user: admin } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');

      await expect(service.convertToCompanyAccount(admin.id!, 'New Name')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to convert an account that already has a Company', async () => {
      const { service } = await build();
      const { user } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');
      // Simulate a teammate added to that same company -- still role=user,
      // but their account already has a Company row.
      user.role = Role.USER;

      await expect(service.convertToCompanyAccount(user.id!, 'Acme Inc 2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('company-scoped team management', () => {
    it('inviteUser adds a Normal User scoped to the inviter\'s own account, auto-approved immediately', async () => {
      const { service } = await build();

      const invited = await service.inviteUser('acc_1', 'teammate@acme.com');

      expect(invited.accountId).toBe('acc_1');
      expect(invited.role).toBe(Role.USER);
      // Joining a company a Superadmin has ALREADY approved shouldn't
      // require a second, separate approval -- see inviteUser's docstring.
      expect(invited.approvedAt).not.toBeNull();
    });

    it('inviteUser rejects an email that already belongs to any account', async () => {
      const { service } = await build();
      await service.inviteUser('acc_1', 'teammate@acme.com');

      await expect(service.inviteUser('acc_2', 'teammate@acme.com')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("removeUser removes a Normal User from the caller's own account", async () => {
      const { service, users } = await build();
      const invited = await service.inviteUser('acc_1', 'teammate@acme.com');

      await service.removeUser('acc_1', invited.id);

      expect(users.rows.has(invited.id)).toBe(false);
    });

    it("removeUser refuses to touch a user belonging to a DIFFERENT company/account -- the critical cross-tenant guard", async () => {
      const { service } = await build();
      const invited = await service.inviteUser('acc_1', 'teammate@acme.com');

      // A Company Admin of acc_2 must never be able to remove acc_1's user,
      // even though they supply that user's real id.
      await expect(service.removeUser('acc_2', invited.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('removeUser refuses to remove a company_admin or superadmin', async () => {
      const { service } = await build();
      const { user: admin } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');

      await expect(service.removeUser(admin.accountId, admin.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('superadmin approval workflow', () => {
    it('listPendingApprovals returns unapproved company_admin AND unapproved solo-user signups, but not an auto-approved invited teammate', async () => {
      const { service } = await build();
      const { user: pendingAdmin } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');
      const { user: approvedAdmin } = await service.createCompanyAdmin(
        'Other Co',
        'other@co.com',
      );
      await service.approveUser(approvedAdmin.id, 'superadmin_1');
      await service.inviteUser(pendingAdmin.accountId, 'not-pending@acme.com'); // auto-approved, must be excluded
      const { user: pendingSolo } = await service.findOrCreateForEmail('solo-pending@example.com');

      const pendingList = await service.listPendingApprovals();

      expect(pendingList.map((u) => u.id).sort()).toEqual(
        [pendingAdmin.id, pendingSolo.id].sort(),
      );
    });

    it('approveUser sets approvedAt/approvedBy, unblocking the approval gate -- works for a Company Admin or a solo user', async () => {
      const { service } = await build();
      const { user: admin } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');
      const { user: solo } = await service.findOrCreateForEmail('solo@example.com');

      const approvedAdmin = await service.approveUser(admin.id, 'superadmin_1');
      const approvedSolo = await service.approveUser(solo.id, 'superadmin_1');

      expect(approvedAdmin.approvedAt).not.toBeNull();
      expect(approvedAdmin.approvedById).toBe('superadmin_1');
      expect(approvedSolo.approvedAt).not.toBeNull();
      expect(approvedSolo.approvedById).toBe('superadmin_1');
    });

    it('approveUser refuses to touch a Superadmin -- never subject to approval in the first place', async () => {
      const { service, users } = await build();
      const superadmin = users.create({
        id: 'root',
        email: 'root@example.com',
        accountId: 'acc_root',
        role: Role.SUPERADMIN,
        approvedAt: new Date(),
      });
      await users.save(superadmin);

      await expect(service.approveUser(superadmin.id, 'superadmin_1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejectUser deletes the whole never-yet-used account -- for a pending Company Admin or a pending solo user', async () => {
      const { service, accountsService } = await build();
      const { user: admin } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');
      const { user: solo } = await service.findOrCreateForEmail('solo-reject@example.com');

      await service.rejectUser(admin.id);
      await service.rejectUser(solo.id);

      expect(accountsService.remove).toHaveBeenCalledWith(admin.accountId);
      expect(accountsService.remove).toHaveBeenCalledWith(solo.accountId);
    });

    it('rejectUser refuses to touch an already-approved account', async () => {
      const { service } = await build();
      const { user } = await service.createCompanyAdmin('Acme Inc', 'admin@acme.com');
      await service.approveUser(user.id, 'superadmin_1');

      await expect(service.rejectUser(user.id)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cross-company user search (superadmin)', () => {
    it('searchByEmail returns only case-insensitive partial matches, scoped by email alone', async () => {
      const { service } = await build();
      await service.findOrCreateForEmail('Alice@Example.com');
      await service.findOrCreateForEmail('bob@example.com');
      await service.findOrCreateForEmail('alice2@other.com');

      const results = await service.searchByEmail('alice');

      expect(results.map((u) => u.email).sort()).toEqual(
        ['Alice@Example.com', 'alice2@other.com'].sort(),
      );
    });

    it('searchByEmail refuses a too-short query instead of listing every user', async () => {
      const { service } = await build();
      await service.findOrCreateForEmail('someone@example.com');

      await expect(service.searchByEmail('a')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.searchByEmail('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('searchByEmail caps results at the max limit', async () => {
      const { service } = await build();
      for (let i = 0; i < 5; i++) {
        await service.findOrCreateForEmail(`match${i}@example.com`);
      }

      const results = await service.searchByEmail('match', 2);

      expect(results).toHaveLength(2);
    });

    it('companyNamesByAccountIds maps accountId to Company name, leaving solo accounts unmapped', async () => {
      const { service } = await build();
      const { user: admin, account } = await service.createCompanyAdmin(
        'Acme Inc',
        'admin@acme.com',
      );
      const { account: soloAccount } = await service.findOrCreateForEmail('solo@example.com');

      const map = await service.companyNamesByAccountIds([account.id, soloAccount.id]);

      expect(map.get(admin.accountId)).toBe('Acme Inc');
      expect(map.has(soloAccount.id)).toBe(false);
    });
  });

  describe('superadmin user suspend/reactivate', () => {
    it('suspendUser sets suspendedAt on a non-superadmin user', async () => {
      const { service } = await build();
      const { user } = await service.findOrCreateForEmail('target@example.com');

      const suspended = await service.suspendUser(user.id);

      expect(suspended.suspendedAt).not.toBeNull();
      expect(suspended.suspendedAt).toBeInstanceOf(Date);
    });

    it('suspendUser refuses to suspend a superadmin', async () => {
      const { service, users } = await build();
      const admin = await users.save(
        users.create({ email: 'root@streambird.com', role: Role.SUPERADMIN, accountId: 'acc_x' }),
      );

      await expect(service.suspendUser(admin.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(admin.suspendedAt ?? null).toBeNull();
    });

    it('reactivateUser clears suspendedAt', async () => {
      const { service } = await build();
      const { user } = await service.findOrCreateForEmail('target2@example.com');
      await service.suspendUser(user.id);

      const reactivated = await service.reactivateUser(user.id);

      expect(reactivated.suspendedAt).toBeNull();
    });
  });
});
