import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  it('resolveInviteToken rejects an expired invite', async () => {
    const { service, inviteRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    } as any);

    await expect(service.resolveInviteToken('tok')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveInviteToken rejects an already-consumed invite', async () => {
    const { service, inviteRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    await expect(service.resolveInviteToken('tok')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumeInviteAndJoin marks the invite used and records a guest participant exactly once', async () => {
    const { service, inviteRepo, participantRepo } = await build();
    inviteRepo.rows.set('i1', {
      id: 'i1',
      token: 'tok',
      studioSessionId: 's1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const participant = await service.consumeInviteAndJoin('tok', 'Alex');

    expect(participant.role).toBe(ParticipantRole.GUEST);
    expect(participant.displayName).toBe('Alex');
    expect(inviteRepo.rows.get('i1')!.revokedAt).not.toBeNull();

    // Second attempt with the same (now-consumed) token must fail.
    await expect(service.consumeInviteAndJoin('tok', 'Alex again')).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
