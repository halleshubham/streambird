import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { StreamSchedulingService } from './stream-scheduling.service';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';

const ACCOUNT = { id: 'acc_1', name: 'Acme Studio' } as any;
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

function build() {
  let n = 0;
  const streams = new Map<string, any>();
  const dests = new Map<string, any>();
  const invites = new Map<string, any>();
  const conns = new Map<string, any>([
    ['11111111-1111-4111-8111-111111111111', { id: '11111111-1111-4111-8111-111111111111', accountId: 'acc_1', platform: 'youtube', label: 'My channel' }],
    ['22222222-2222-4222-8222-222222222222', { id: '22222222-2222-4222-8222-222222222222', accountId: 'acc_1', platform: 'twitch', label: 'My twitch' }],
    ['33333333-3333-4333-8333-333333333333', { id: '33333333-3333-4333-8333-333333333333', accountId: 'other', platform: 'twitch', label: 'Not mine' }],
  ]);
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => (v && (v as any).value ? (v as any).value.includes(row[k]) : row[k] === v));

  const liveStreams = {
    create: (v: any) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      if (!v.id) v.id = `stream_${++n}`;
      streams.set(v.id, v);
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => [...streams.values()].find((r) => matches(r, where)) ?? null),
    delete: jest.fn(async (where: any) => {
      for (const [k, r] of [...streams.entries()]) if (matches(r, where)) streams.delete(k);
    }),
  };
  const destinations = {
    create: (v: any) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      for (const row of Array.isArray(v) ? v : [v]) {
        if (!row.id) row.id = `dest_${++n}`;
        dests.set(row.id, row);
      }
      return v;
    }),
    find: jest.fn(async ({ where }: any) =>
      [...dests.values()].filter((r) => matches(r, where)).map((r) => ({ ...r, platformConnection: conns.get(r.platformConnectionId) })),
    ),
    delete: jest.fn(async (where: any) => {
      for (const [k, r] of [...dests.entries()]) if (matches(r, where)) dests.delete(k);
    }),
  };
  const platformConnections = { find: jest.fn(async ({ where }: any) => [...conns.values()].filter((r) => matches(r, where))) };

  const studioSessions = {
    createForStream: jest.fn(async (s: any) => ({ id: `sess_${s.id}` })),
    findByLiveStreamId: jest.fn(async (id: string) => ({ id: `sess_${id}` })),
    createInvite: jest.fn(async (sessionId: string, _acc: string, dto: any) => {
      const row = { id: `inv_${++n}`, studioSessionId: sessionId, token: `tok_${n}`, label: dto.label, email: null, passwordHash: dto.password ? `hash(${dto.password})` : null, emailedAt: null, revokedAt: null };
      invites.set(row.id, row);
      return { id: row.id, token: row.token, joinUrl: '', expiresAt: null };
    }),
    createEmailInvite: jest.fn(async (sessionId: string, _acc: string, o: any) => {
      const row = { id: `inv_${++n}`, studioSessionId: sessionId, token: `tok_${n}`, label: o.email, email: o.email, passwordHash: o.passwordHash ?? (o.password ? `hash(${o.password})` : null), emailedAt: null, revokedAt: null };
      invites.set(row.id, row);
      return row;
    }),
    listActiveInvites: jest.fn(async (sessionId: string) => [...invites.values()].filter((i) => i.studioSessionId === sessionId && !i.revokedAt)),
    markInviteEmailed: jest.fn(async (id: string) => { invites.get(id).emailedAt = new Date(); }),
    revokeInvite: jest.fn(async (_s: string, id: string) => { invites.get(id).revokedAt = new Date(); }),
    joinUrlFor: (t: string) => `https://app.example.com/join/${t}`,
  };
  const streamsService = { end: jest.fn(async () => undefined) };
  const email = { sendStreamInvite: jest.fn(async () => undefined) };

  const service = new StreamSchedulingService(
    liveStreams as any, destinations as any, platformConnections as any, studioSessions as any, streamsService as any, email as any,
  );
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, streams, dests, invites, studioSessions, streamsService, email };
}

const CONN_YT = '11111111-1111-4111-8111-111111111111';
const CONN_TW = '22222222-2222-4222-8222-222222222222';
const CONN_OTHER = '33333333-3333-4333-8333-333333333333';

const baseDto = () => ({
  title: '  Launch Q&A ',
  scheduledAt: inOneHour(),
  timezone: 'Asia/Kolkata',
  destinationConnectionIds: [CONN_YT, CONN_TW],
  guestEmails: ['a@example.com', 'b@example.com', 'a@example.com'],
  durationMinutes: 60,
  guestNotes: 'Join early',
});

describe('StreamSchedulingService', () => {
  it('schedules without provisioning anything: SCHEDULED stream, pending destinations, general link and one invite per unique email', async () => {
    const { service, streams, dests, studioSessions, email } = build();

    const detail = await service.schedule(ACCOUNT, baseDto());

    const stream = [...streams.values()][0];
    expect(stream.status).toBe(StreamStatus.SCHEDULED);
    expect(stream.isScheduledEvent).toBe(true);
    expect(stream.title).toBe('Launch Q&A');
    expect(stream.timezone).toBe('Asia/Kolkata');
    expect(stream.whipUrl).toBeUndefined(); // nothing registered with MediaMTX
    expect([...dests.values()].map((d) => d.status)).toEqual([DestinationStatus.PENDING, DestinationStatus.PENDING]);
    expect(studioSessions.createInvite).toHaveBeenCalledTimes(1); // the general link
    expect(studioSessions.createEmailInvite).toHaveBeenCalledTimes(2); // duplicate address collapsed
    expect(email.sendStreamInvite).toHaveBeenCalledTimes(2);

    expect(detail.guests.map((g) => g.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(detail.guests.every((g) => g.emailedAt)).toBe(true);
    expect(detail.destinations.map((d) => d.platform)).toEqual(['youtube', 'twitch']);
    expect(detail.generalJoinUrl).toMatch(/^https:\/\/app\.example\.com\/join\/tok_/);
    expect(detail.invitationText).toContain('Join link: ' + detail.generalJoinUrl);
    expect(detail.invitationText).toContain('Streaming live to: YouTube, Twitch');
    expect(detail.emailFailures).toEqual([]);
  });

  it('sends each guest their own personal link with the right details', async () => {
    const { service, email } = build();
    await service.schedule(ACCOUNT, baseDto());

    const calls = (email.sendStreamInvite as jest.Mock).mock.calls;
    expect(calls[0][0]).toBe('a@example.com');
    expect(calls[1][0]).toBe('b@example.com');
    expect(calls[0][1].joinUrl).not.toBe(calls[1][1].joinUrl);
    expect(calls[0][1]).toMatchObject({ kind: 'invite', title: 'Launch Q&A', hostName: 'Acme Studio', timezone: 'Asia/Kolkata', durationMinutes: 60, notes: 'Join early', passwordProtected: false });
  });

  it('reports addresses that failed to send instead of failing the whole schedule', async () => {
    const { service, email } = build();
    (email.sendStreamInvite as jest.Mock).mockImplementation(async (to: string) => {
      if (to === 'b@example.com') throw new Error('mailbox full');
    });

    const detail = await service.schedule(ACCOUNT, baseDto());

    expect(detail.emailFailures).toEqual(['b@example.com']);
    expect(detail.guests.find((g) => g.email === 'a@example.com')!.emailedAt).toBeTruthy();
    expect(detail.guests.find((g) => g.email === 'b@example.com')!.emailedAt).toBeNull();
  });

  it('rejects a start time in the past, an invalid timezone and someone else\'s destination', async () => {
    const { service, streams } = build();

    await expect(service.schedule(ACCOUNT, { ...baseDto(), scheduledAt: new Date(Date.now() - 1000).toISOString() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.schedule(ACCOUNT, { ...baseDto(), timezone: 'Mars/Olympus' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.schedule(ACCOUNT, { ...baseDto(), destinationConnectionIds: [CONN_OTHER] })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(streams.size).toBe(0);
  });

  it('marks invites password-protected and never puts the password in the email data', async () => {
    const { service, email } = build();
    const detail = await service.schedule(ACCOUNT, { ...baseDto(), invitePassword: 's3cret' });

    expect(detail.passwordProtected).toBe(true);
    expect(detail.invitationText).toContain('Password: required');
    expect(JSON.stringify((email.sendStreamInvite as jest.Mock).mock.calls)).not.toContain('s3cret');
  });

  it('emails guests when the time changes, but not when nothing relevant changed or notify is off', async () => {
    const { service, email } = build();
    const detail = await service.schedule(ACCOUNT, baseDto());
    (email.sendStreamInvite as jest.Mock).mockClear();

    await service.update(ACCOUNT, detail.id, { visibility: 'public' });
    expect(email.sendStreamInvite).not.toHaveBeenCalled();

    await service.update(ACCOUNT, detail.id, { scheduledAt: new Date(Date.now() + 7_200_000).toISOString(), notifyGuests: false });
    expect(email.sendStreamInvite).not.toHaveBeenCalled();

    await service.update(ACCOUNT, detail.id, { title: 'Renamed' });
    expect(email.sendStreamInvite).toHaveBeenCalledTimes(2);
    expect((email.sendStreamInvite as jest.Mock).mock.calls[0][1]).toMatchObject({ kind: 'update', title: 'Renamed' });
  });

  it('only lets a not-yet-started scheduled stream be changed', async () => {
    const { service, streams } = build();
    const detail = await service.schedule(ACCOUNT, baseDto());
    streams.get(detail.id).status = StreamStatus.LIVE;

    await expect(service.update(ACCOUNT, detail.id, { title: 'x' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.update(ACCOUNT, 'missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds only new guests, inherits the password, and enforces the per-stream cap', async () => {
    const { service, studioSessions, email } = build();
    const detail = await service.schedule(ACCOUNT, { ...baseDto(), invitePassword: 'pw' });
    (email.sendStreamInvite as jest.Mock).mockClear();

    const after = await service.addGuests(ACCOUNT, detail.id, { emails: ['a@example.com', 'c@example.com'] });

    expect(email.sendStreamInvite).toHaveBeenCalledTimes(1); // a@ already invited
    expect((email.sendStreamInvite as jest.Mock).mock.calls[0][0]).toBe('c@example.com');
    expect((studioSessions.createEmailInvite as jest.Mock).mock.calls.at(-1)![2].passwordHash).toBe('hash(pw)');
    expect(after.guests).toHaveLength(3);

    // 3 guests so far; two more batches of 20 reach 43, a third would pass the cap of 50.
    const batch = (prefix: string) => ({ emails: Array.from({ length: 20 }, (_, i) => `${prefix}${i}@example.com`) });
    await service.addGuests(ACCOUNT, detail.id, batch('x'));
    await service.addGuests(ACCOUNT, detail.id, batch('y'));
    await expect(service.addGuests(ACCOUNT, detail.id, batch('z'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removing a guest revokes their link; resend re-emails just that guest', async () => {
    const { service, email } = build();
    const detail = await service.schedule(ACCOUNT, baseDto());
    (email.sendStreamInvite as jest.Mock).mockClear();

    await service.resendInvite(ACCOUNT, detail.id, detail.guests[0].id);
    expect(email.sendStreamInvite).toHaveBeenCalledTimes(1);

    const after = await service.removeGuest(ACCOUNT, detail.id, detail.guests[0].id);
    expect(after.guests.map((g) => g.email)).toEqual(['b@example.com']);
  });

  it('cancel tells every invited guest, records the cancellation, then ends the stream', async () => {
    const { service, streams, streamsService, email } = build();
    const detail = await service.schedule(ACCOUNT, baseDto());
    (email.sendStreamInvite as jest.Mock).mockClear();

    await service.cancel(ACCOUNT, detail.id);

    const calls = (email.sendStreamInvite as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c[1].kind === 'cancelled')).toBe(true);
    expect(streams.get(detail.id).cancelledAt).toBeInstanceOf(Date);
    expect(streamsService.end).toHaveBeenCalledWith(detail.id, 'acc_1');
  });

  it('delete discards a scheduled stream silently -- no emails -- and refuses one that has started', async () => {
    const { service, streams, email } = build();
    const detail = await service.schedule(ACCOUNT, baseDto());
    (email.sendStreamInvite as jest.Mock).mockClear();

    await service.delete(ACCOUNT, detail.id);
    expect(streams.has(detail.id)).toBe(false);
    expect(email.sendStreamInvite).not.toHaveBeenCalled();

    const live = await service.schedule(ACCOUNT, baseDto());
    streams.get(live.id).status = StreamStatus.LIVE;
    await expect(service.delete(ACCOUNT, live.id)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(streams.has(live.id)).toBe(true);

    await expect(service.delete({ id: 'someone_else' } as any, live.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
