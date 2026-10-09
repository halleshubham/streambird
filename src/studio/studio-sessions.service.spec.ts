import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { StudioSessionsService } from './studio-sessions.service';
import { StudioSession } from './entities/studio-session.entity';
import { StudioGuestInvite } from './entities/studio-guest-invite.entity';
import { StudioParticipant, ParticipantRole } from './entities/studio-participant.entity';
import { StudioHostToken } from './entities/studio-host-token.entity';

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
    findOne: jest.fn(async ({ where }: any) => {
      return (
        [...rows.values()].find((r: any) =>
          Object.entries(where).every(([k, val]) => r[k] === val),
        ) ?? null
      );
    }),
    find: jest.fn(async ({ where }: any) => {
      return [...rows.values()].filter((r: any) =>
        Object.entries(where).every(([k, val]) => r[k] === val),
      );
    }),
    update: jest.fn(async (where: any, partial: any) => {
      const matches = [...rows.values()].filter((r: any) =>
        Object.entries(where).every(([k, val]) => r[k] === val),
      );
      matches.forEach((m: any) => Object.assign(m, partial));
      return { affected: matches.length };
    }),
  };
}

describe('StudioSessionsService', () => {
  async function build() {
    const sessionRepo = inMemoryRepo<StudioSession>();
    const inviteRepo = inMemoryRepo<StudioGuestInvite>();
    const participantRepo = inMemoryRepo<StudioParticipant>();
    const hostTokenRepo = inMemoryRepo<StudioHostToken>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioSessionsService,
        { provide: getRepositoryToken(StudioSession), useValue: sessionRepo },
        { provide: getRepositoryToken(StudioGuestInvite), useValue: inviteRepo },
        { provide: getRepositoryToken(StudioParticipant), useValue: participantRepo },
        { provide: getRepositoryToken(StudioHostToken), useValue: hostTokenRepo },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
      ],
    }).compile();

    return {
      service: moduleRef.get(StudioSessionsService),
      sessionRepo,
      inviteRepo,
      participantRepo,
      hostTokenRepo,
    };
  }

  it('createForStream creates a session with a default grid layout', async () => {
    const { service } = await build();
    const session = await service.createForStream({ id: 'stream_1' } as any);
    expect(session.liveStreamId).toBe('stream_1');
    expect(session.layoutConfig).toEqual({ layout: 'grid', overlays: [] });
  });

  it('createInvite returns a token and a joinUrl built from publicBaseUrl', async () => {
    const { service, sessionRepo } = await build();
    sessionRepo.rows.set('s1', {
      id: 's1',
      liveStream: { accountId: 'acc_1' },
    } as any);

    const result = await service.createInvite('s1', 'acc_1', { label: 'Co-host' });

    expect(result.token).toHaveLength(32); // 24 random bytes, base64url
    expect(result.joinUrl).toBe(`http://localhost:3000/join/${result.token}`);
  });

  it('createInvite rejects a session not owned by the requesting account', async () => {
    const { service, sessionRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'someone_else' } } as any);

    await expect(
      service.createInvite('s1', 'acc_1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveInviteToken rejects a revoked invite', async () => {
    const { service, inviteRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: new Date(),
      expiresAt: null,
    } as any);

    await expect(service.resolveInviteToken('tok')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveInviteToken honors a legacy expiresAt if one is still set, but new invites never set one', async () => {
    const { service, sessionRepo, inviteRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'acc_1' } } as any);
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'expired-legacy',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    } as any);

    await expect(service.resolveInviteToken('expired-legacy')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const created = await service.createInvite('s1', 'acc_1', { label: 'Co-host' });
    expect(created.expiresAt).toBeNull();
  });

  it('joinAsGuest does not revoke the invite -- the same token can join/rejoin repeatedly', async () => {
    const { service, inviteRepo, participantRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: null,
      passwordHash: null,
    } as any);

    const participant = await service.joinAsGuest('tok', 'Alex');

    expect(participant.role).toBe(ParticipantRole.GUEST);
    expect(participant.displayName).toBe('Alex');
    expect(inviteRepo.rows.get('i1')!.revokedAt).toBeNull();

    // A reconnect with the same token (network blip, tab refresh) must
    // keep succeeding -- this is exactly the bug being fixed.
    const rejoined = await service.joinAsGuest('tok', 'Alex again');
    expect(rejoined.role).toBe(ParticipantRole.GUEST);
    expect(inviteRepo.rows.get('i1')!.revokedAt).toBeNull();
  });

  it('createInvite stores a sha256 password hash when a password is provided', async () => {
    const { service, sessionRepo, inviteRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'acc_1' } } as any);

    const result = await service.createInvite('s1', 'acc_1', { password: 'secret123' });

    const stored = [...inviteRepo.rows.values()].find((r: any) => r.token === result.token) as any;
    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash).not.toBe('secret123');
  });

  it('joinAsGuest rejects a missing or wrong password when the invite requires one', async () => {
    const { service, inviteRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: null,
      // sha256('correct-password')
      passwordHash: crypto.createHash('sha256').update('correct-password').digest('hex'),
    } as any);

    await expect(service.joinAsGuest('tok', 'Alex')).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.joinAsGuest('tok', 'Alex', 'wrong-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checkInvitePassword refuses a wrong or missing password and passes the right one (or no password needed)', async () => {
    const { service, inviteRepo } = await build();
    const base = { studioSessionId: 's1', revokedAt: null, expiresAt: null };
    inviteRepo.rows.set('i1', { id: 'i1', token: 'locked', ...base, passwordHash: crypto.createHash('sha256').update('correct-password').digest('hex') } as any);
    inviteRepo.rows.set('i2', { id: 'i2', token: 'open', ...base, passwordHash: null } as any);

    await expect(service.checkInvitePassword('locked')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkInvitePassword('locked', 'nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkInvitePassword('locked', 'correct-password')).resolves.toBeUndefined();
    await expect(service.checkInvitePassword('open')).resolves.toBeUndefined();
    await expect(service.checkInvitePassword('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('joinAsGuest accepts the correct password when the invite requires one', async () => {
    const { service, inviteRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: null,
      passwordHash: crypto.createHash('sha256').update('correct-password').digest('hex'),
    } as any);

    const participant = await service.joinAsGuest('tok', 'Alex', 'correct-password');
    expect(participant.role).toBe(ParticipantRole.GUEST);
  });

  it('revokeInvitesForStream revokes every invite on that stream\'s studio session', async () => {
    const { service, sessionRepo, inviteRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStreamId: 'stream_1' } as any);
    inviteRepo.rows.set('i1', {
      id: 'i1',
      studioSessionId: 's1',
      token: 'tok-1',
      revokedAt: null,
      expiresAt: null,
    } as any);

    await service.revokeInvitesForStream('stream_1');

    expect(inviteRepo.rows.get('i1')!.revokedAt).not.toBeNull();
  });

  it('revokeInvitesForStream is a no-op when the stream has no studio session', async () => {
    const { service } = await build();
    await expect(service.revokeInvitesForStream('unknown_stream')).resolves.toBeUndefined();
  });

  it('revokeInvite marks the invite revoked when owned by the account', async () => {
    const { service, sessionRepo, inviteRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'acc_1' } } as any);
    inviteRepo.rows.set('i1', { id: 'i1', studioSessionId: 's1', revokedAt: null } as any);

    await service.revokeInvite('s1', 'i1', 'acc_1');

    expect(inviteRepo.rows.get('i1')!.revokedAt).not.toBeNull();
  });

  it('mintHostToken rejects a session not owned by the requesting account', async () => {
    const { service, sessionRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'someone_else' } } as any);

    await expect(service.mintHostToken('s1', 'acc_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mintHostToken revokes any prior token for the session -- only one active at a time', async () => {
    const { service, sessionRepo, hostTokenRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStream: { accountId: 'acc_1' } } as any);
    hostTokenRepo.rows.set('t1', {
      id: 't1',
      studioSessionId: 's1',
      token: 'old-token',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const result = await service.mintHostToken('s1', 'acc_1');

    expect(result.token).toHaveLength(32); // 24 random bytes, base64url
    expect(hostTokenRepo.rows.get('t1')!.revokedAt).not.toBeNull();
    const minted = [...hostTokenRepo.rows.values()].find((t: any) => t.token === result.token);
    expect((minted as any).revokedAt).toBeFalsy();
  });

  it('resolveHostToken rejects an unknown, revoked, or expired token', async () => {
    const { service, hostTokenRepo } = await build();
    hostTokenRepo.rows.set('t1', {
      id: 't1',
      studioSessionId: 's1',
      token: 'revoked-token',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);
    hostTokenRepo.rows.set('t2', {
      id: 't2',
      studioSessionId: 's1',
      token: 'expired-token',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    } as any);

    await expect(service.resolveHostToken('nonexistent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.resolveHostToken('revoked-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.resolveHostToken('expired-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resolveHostToken does not consume the token -- resolving twice both succeed', async () => {
    const { service, hostTokenRepo } = await build();
    hostTokenRepo.rows.set('t1', {
      id: 't1',
      studioSessionId: 's1',
      token: 'good-token',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    await service.resolveHostToken('good-token');
    const secondResolve = await service.resolveHostToken('good-token');

    expect(secondResolve.studioSessionId).toBe('s1');
  });

  it('revokeHostTokensForStream revokes every token on that stream\'s studio session', async () => {
    const { service, sessionRepo, hostTokenRepo } = await build();
    sessionRepo.rows.set('s1', { id: 's1', liveStreamId: 'stream_1' } as any);
    hostTokenRepo.rows.set('t1', {
      id: 't1',
      studioSessionId: 's1',
      token: 'tok-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    await service.revokeHostTokensForStream('stream_1');

    expect(hostTokenRepo.rows.get('t1')!.revokedAt).not.toBeNull();
  });

  it('revokeHostTokensForStream is a no-op when the stream has no studio session', async () => {
    const { service } = await build();
    await expect(service.revokeHostTokensForStream('unknown_stream')).resolves.toBeUndefined();
  });
});
