import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { LoginCode } from './entities/login-code.entity';
import { UserSession } from './entities/user-session.entity';
import { UsersService } from '../users/users.service';
import { EMAIL_SERVICE } from '../email/email.interface';
import { Role } from '../common/enums/role.enum';
import { hashPassword } from './password.util';

function inMemoryRepo<T extends { id?: string }>() {
  const rows = new Map<string, T>();
  let counter = 0;
  return {
    rows,
    create: jest.fn((v: Partial<T>) => ({ ...v }) as T),
    save: jest.fn(async (v: T) => {
      if (!v.id) v.id = `id_${++counter}`;
      rows.set(v.id, v);
      return v;
    }),
    findOne: jest.fn(async ({ where, order }: any) => {
      let matches = [...rows.values()].filter((r: any) =>
        Object.entries(where).every(([k, val]) => r[k] === val),
      );
      if (order?.createdAt === 'DESC') {
        matches = matches.sort(
          (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      }
      return matches[0] ?? null;
    }),
    update: jest.fn(async (where: any, partial: any) => {
      const match = [...rows.values()].find((r: any) =>
        Object.entries(where).every(([k, val]) => r[k] === val),
      );
      if (!match) return { affected: 0 };
      Object.assign(match, partial);
      return { affected: 1 };
    }),
  };
}

describe('AuthService', () => {
  async function build() {
    const loginCodes = inMemoryRepo<LoginCode>();
    const sessions = inMemoryRepo<UserSession>();
    const fakeUser = { id: 'user_1', email: 'tester@example.com', account: undefined as any };
    const fakeAccount = { id: 'acc_1' };
    const fakeCompany = { id: 'company_1', accountId: fakeAccount.id };
    const usersByEmail = new Map<string, any>();
    const usersService = {
      findOrCreateForEmail: jest.fn(async () => ({ user: fakeUser, account: fakeAccount })),
      findByEmail: jest.fn(async (email: string) => usersByEmail.get(email) ?? null),
      createCompanyAdmin: jest.fn(async (companyName: string, email: string) => {
        const user = {
          id: 'admin_1',
          email,
          accountId: 'acc_2',
          role: Role.COMPANY_ADMIN,
          approvedAt: null,
        };
        return { user, account: { id: 'acc_2' }, company: { ...fakeCompany, name: companyName } };
      }),
    };
    const emailService = {
      sendLoginCode: jest.fn(async (_to: string, _code: string) => undefined),
    };

    // The real repo applies column defaults (attempts=0, createdAt=now) on
    // create/insert -- this fake doesn't, so set them explicitly here.
    loginCodes.create.mockImplementation(
      (v: Partial<LoginCode>) =>
        ({ attempts: 0, consumedAt: null, createdAt: new Date(), ...v }) as LoginCode,
    );

    // The real repo's relations:['user','user.account'] join loads these;
    // this fake just stores flat rows, so attach them the same way a real
    // join would once a matching session is found.
    const findSession = sessions.findOne.getMockImplementation()!;
    sessions.findOne.mockImplementation(async (query: any) => {
      const found = await findSession(query);
      if (found && query.relations?.includes('user')) {
        (found as any).user = { ...fakeUser, account: fakeAccount };
      }
      return found;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(LoginCode), useValue: loginCodes },
        { provide: getRepositoryToken(UserSession), useValue: sessions },
        { provide: UsersService, useValue: usersService },
        { provide: EMAIL_SERVICE, useValue: emailService },
      ],
    }).compile();

    return {
      service: moduleRef.get(AuthService),
      loginCodes,
      sessions,
      usersService,
      usersByEmail,
      emailService,
      fakeUser,
      fakeAccount,
    };
  }

  it('requestCode normalizes the email, stores a hashed code, and emails it', async () => {
    const { service, loginCodes, emailService } = await build();

    await service.requestCode('  Tester@Example.com ');

    expect(loginCodes.rows.size).toBe(1);
    const stored = [...loginCodes.rows.values()][0] as any;
    expect(stored.email).toBe('tester@example.com');
    expect(emailService.sendLoginCode).toHaveBeenCalledWith(
      'tester@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(stored.codeHash).not.toBe(emailService.sendLoginCode.mock.calls[0][1]);
  });

  it('verifyCode succeeds with the correct code, minting exactly one session', async () => {
    const { service, emailService, usersService, sessions } = await build();

    await service.requestCode('tester@example.com');
    const code = emailService.sendLoginCode.mock.calls[0][1];

    const result = await service.verifyCode('tester@example.com', code, {});

    expect(usersService.findOrCreateForEmail).toHaveBeenCalledTimes(1);
    expect(result.token).toHaveLength(43); // 32 random bytes, base64url
    expect(sessions.rows.size).toBe(1);
  });

  it('verifyCode rejects an expired code', async () => {
    const { service, loginCodes } = await build();
    loginCodes.rows.set('lc1', {
      id: 'lc1',
      email: 'tester@example.com',
      codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
      attempts: 0,
      createdAt: new Date(),
    } as any);

    await expect(
      service.verifyCode('tester@example.com', '123456', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifyCode caps wrong guesses and forces a fresh code after the limit', async () => {
    const { service, emailService } = await build();
    await service.requestCode('tester@example.com');
    const code = emailService.sendLoginCode.mock.calls[0][1];
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
      await expect(
        service.verifyCode('tester@example.com', wrongCode, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    // 5th wrong attempt hits MAX_ATTEMPTS and force-consumes the code.
    await expect(
      service.verifyCode('tester@example.com', wrongCode, {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Even the *correct* code is now rejected -- the code was consumed by
    // hitting the attempts cap, matching how a StudioGuestInvite is
    // consumed once it's used up.
    await expect(
      service.verifyCode('tester@example.com', code, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifyCode is single-use: a second verify with the same code fails', async () => {
    const { service, emailService } = await build();
    await service.requestCode('tester@example.com');
    const code = emailService.sendLoginCode.mock.calls[0][1];

    await service.verifyCode('tester@example.com', code, {});

    await expect(
      service.verifyCode('tester@example.com', code, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveSession returns the user/account for a valid token and updates lastSeenAt', async () => {
    const { service, emailService, sessions } = await build();
    await service.requestCode('tester@example.com');
    const code = emailService.sendLoginCode.mock.calls[0][1];
    const { token } = await service.verifyCode('tester@example.com', code, {});

    const resolved = await service.resolveSession(token);

    expect(resolved?.user.id).toBe('user_1');
    expect(resolved?.account.id).toBe('acc_1');
    const stored = [...sessions.rows.values()][0] as any;
    expect(stored.lastSeenAt).not.toBeNull();
  });

  it('resolveSession returns null for an unknown token', async () => {
    const { service } = await build();
    expect(await service.resolveSession('not-a-real-token')).toBeNull();
  });

  it('logout revokes the session so resolveSession stops accepting it', async () => {
    const { service, emailService } = await build();
    await service.requestCode('tester@example.com');
    const code = emailService.sendLoginCode.mock.calls[0][1];
    const { token } = await service.verifyCode('tester@example.com', code, {});

    await service.logout(token);

    expect(await service.resolveSession(token)).toBeNull();
  });

  describe('verifyCompanySignup', () => {
    it('consumes the code and delegates creation to UsersService.createCompanyAdmin, minting a session', async () => {
      const { service, emailService, usersService, sessions } = await build();
      await service.requestCode('admin@acme.com');
      const code = emailService.sendLoginCode.mock.calls[0][1];

      const result = await service.verifyCompanySignup('Acme Inc', 'admin@acme.com', code, {});

      expect(usersService.createCompanyAdmin).toHaveBeenCalledWith('Acme Inc', 'admin@acme.com');
      expect(result.user.role).toBe(Role.COMPANY_ADMIN);
      expect(result.token).toHaveLength(43);
      expect(sessions.rows.size).toBe(1);
    });

    it('rejects an invalid code exactly like verifyCode does, without creating anything', async () => {
      const { service, usersService } = await build();

      await expect(
        service.verifyCompanySignup('Acme Inc', 'admin@acme.com', '000000', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usersService.createCompanyAdmin).not.toHaveBeenCalled();
    });
  });

  describe('superadminLogin', () => {
    it('logs in a seeded superadmin with the correct password', async () => {
      const { service, usersByEmail } = await build();
      const passwordHash = hashPassword('correct-horse-battery-staple');
      usersByEmail.set('root@streambird.dev', {
        id: 'root_1',
        email: 'root@streambird.dev',
        role: Role.SUPERADMIN,
        passwordHash,
        account: { id: 'acc_root' },
      });

      const result = await service.superadminLogin(
        'root@streambird.dev',
        'correct-horse-battery-staple',
        {},
      );

      expect(result.user.id).toBe('root_1');
      expect(result.token).toHaveLength(43);
    });

    it('rejects a wrong password', async () => {
      const { service, usersByEmail } = await build();
      usersByEmail.set('root@streambird.dev', {
        id: 'root_1',
        email: 'root@streambird.dev',
        role: Role.SUPERADMIN,
        passwordHash: hashPassword('correct-password'),
        account: { id: 'acc_root' },
      });

      await expect(
        service.superadminLogin('root@streambird.dev', 'wrong-password', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a non-superadmin user even with a set password hash -- role is checked, not just the password', async () => {
      const { service, usersByEmail } = await build();
      usersByEmail.set('notadmin@example.com', {
        id: 'u1',
        email: 'notadmin@example.com',
        role: Role.USER,
        passwordHash: hashPassword('whatever'),
        account: { id: 'acc_1' },
      });

      await expect(
        service.superadminLogin('notadmin@example.com', 'whatever', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown email', async () => {
      const { service } = await build();
      await expect(
        service.superadminLogin('nobody@example.com', 'whatever', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('loginWithGoogleProfile', () => {
    it('resolves identity via the same findOrCreateForEmail path as magic-code login', async () => {
      const { service, usersService, sessions } = await build();

      const result = await service.loginWithGoogleProfile('tester@example.com', {});

      expect(usersService.findOrCreateForEmail).toHaveBeenCalledWith('tester@example.com');
      expect(result.token).toHaveLength(43);
      expect(sessions.rows.size).toBe(1);
    });
  });
});
