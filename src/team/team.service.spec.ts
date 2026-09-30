import { Test } from '@nestjs/testing';
import { TeamService } from './team.service';
import { UsersService } from '../users/users.service';
import { EMAIL_SERVICE } from '../email/email.interface';

describe('TeamService', () => {
  async function build() {
    const usersService = {
      listForAccount: jest.fn(async (accountId: string) => [{ id: 'u1', accountId }]),
      inviteUser: jest.fn(async (accountId: string, email: string) => ({
        id: 'u2',
        accountId,
        email,
        role: 'user',
      })),
      removeUser: jest.fn(async () => undefined),
    };
    const emailService = { sendTeamInvite: jest.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: UsersService, useValue: usersService },
        { provide: EMAIL_SERVICE, useValue: emailService },
      ],
    }).compile();

    return { service: moduleRef.get(TeamService), usersService, emailService };
  }

  it("list() is scoped to exactly the caller's own account", async () => {
    const { service, usersService } = await build();
    await service.list('acc_1');
    expect(usersService.listForAccount).toHaveBeenCalledWith('acc_1');
  });

  it("invite() delegates to UsersService with the caller's own account and sends a notification email", async () => {
    const { service, usersService, emailService } = await build();
    const account = { id: 'acc_1', name: 'Acme Inc' };

    const user = await service.invite(account as any, 'teammate@acme.com');

    expect(usersService.inviteUser).toHaveBeenCalledWith('acc_1', 'teammate@acme.com');
    expect(emailService.sendTeamInvite).toHaveBeenCalledWith('teammate@acme.com', 'Acme Inc');
    expect(user.accountId).toBe('acc_1');
  });

  it("remove() delegates to UsersService with the caller's own account (which is where the real cross-tenant guard lives)", async () => {
    const { service, usersService } = await build();
    await service.remove('acc_1', 'user_5');
    expect(usersService.removeUser).toHaveBeenCalledWith('acc_1', 'user_5');
  });
});
