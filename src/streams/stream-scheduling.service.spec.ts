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
  const thumbs = new Map<string, any>();
  const thumbnails = {
    create: (v: any) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      thumbs.set(v.liveStreamId, { ...v, updatedAt: new Date() });
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => thumbs.get(where.liveStreamId) ?? null),
    delete: jest.fn(async (where: any) => {
      thumbs.delete(where.liveStreamId);
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
  const makeProvider = (name: string, canPrecreate: boolean) => ({
    canPrescheduleBroadcast: canPrecreate,
    createBroadcast: jest.fn(async (_conn: any, _meta: any) => ({
      ingestUrl: `rtmp://${name}/live`,
      streamKey: `${name}-key`,
      platformBroadcastId: `${name}-bc-1`,
      watchUrl: `https://${name}.example/watch/bc-1`,
    })),
    updateBroadcast: jest.fn(async (_conn: any, _id: string, _meta: any) => undefined),
    deleteBroadcast: jest.fn(async (_conn: any, _id: string) => undefined),
    setBroadcastThumbnail: jest.fn(async (_conn: any, _id: string, _image: any) => undefined),
  });
  const providers: Record<string, ReturnType<typeof makeProvider>> = {
    youtube: makeProvider('youtube', true),
    twitch: makeProvider('twitch', false),
  };
  // Behaves like Facebook for the lead-time rule when a test sets it.
  (providers.youtube as any).maxPrescheduleLeadMs = undefined;
  const streamsService = {
    end: jest.fn(async () => undefined),
    resolveProvider: (conn: any) => providers[conn.platform],
  };
  const email = { sendStreamInvite: jest.fn(async () => undefined) };

  const service = new StreamSchedulingService(
    liveStreams as any, destinations as any, platformConnections as any, thumbnails as any, studioSessions as any, streamsService as any, email as any,
  );
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, streams, dests, invites, studioSessions, streamsService, email, providers, thumbs };
}


/** A real (header-only) PNG of the given size -- parseThumbnail reads nothing else. */
function pngBuffer(width = 1280, height = 720): Buffer {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
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

  describe('creating broadcasts on the platforms now', () => {
    const withPlatforms = () => ({ ...baseDto(), createOnPlatforms: true });

    it('pre-creates only on platforms that can hold a scheduled broadcast, and puts the watch link in the invites', async () => {
      const { service, dests, providers, email } = build();

      const detail = await service.schedule(ACCOUNT, withPlatforms());

      expect(providers.youtube.createBroadcast).toHaveBeenCalledTimes(1);
      expect(providers.youtube.createBroadcast.mock.calls[0][1]).toMatchObject({ title: 'Launch Q&A', precreate: true });
      expect((providers.youtube.createBroadcast.mock.calls[0][1] as any).scheduledAt).toBeInstanceOf(Date);
      expect(providers.twitch.createBroadcast).not.toHaveBeenCalled(); // Twitch is created at start

      const rows = [...dests.values()];
      const yt = rows.find((r) => r.platformConnectionId === CONN_YT);
      const tw = rows.find((r) => r.platformConnectionId === CONN_TW);
      expect(yt).toMatchObject({ status: DestinationStatus.READY, platformBroadcastId: 'youtube-bc-1', watchUrl: 'https://youtube.example/watch/bc-1' });
      expect(tw).toMatchObject({ status: DestinationStatus.PENDING });
      expect(tw.platformBroadcastId).toBeUndefined();

      expect(detail.precreateOnPlatforms).toBe(true);
      expect(detail.destinations.find((d) => d.platform === 'youtube')).toMatchObject({ canPrecreate: true, onPlatform: true });
      expect(detail.destinations.find((d) => d.platform === 'twitch')).toMatchObject({ canPrecreate: false, onPlatform: false });
      expect(detail.invitationText).toContain('Watch live:');
      expect(detail.invitationText).toContain('YouTube: https://youtube.example/watch/bc-1');
      expect((email.sendStreamInvite as jest.Mock).mock.calls[0][1].watchLinks).toEqual([
        { platform: 'YouTube', url: 'https://youtube.example/watch/bc-1' },
      ]);
    });

    it('does nothing on the platforms unless asked', async () => {
      const { service, providers } = build();
      const detail = await service.schedule(ACCOUNT, baseDto());
      expect(providers.youtube.createBroadcast).not.toHaveBeenCalled();
      expect(detail.precreateOnPlatforms).toBe(false);
      expect(detail.invitationText).not.toContain('Watch live');
    });

    it('never shares a watch link for a private stream', async () => {
      const { service, email } = build();
      const detail = await service.schedule(ACCOUNT, { ...withPlatforms(), visibility: 'private' });
      expect(detail.invitationText).not.toContain('Watch live');
      expect((email.sendStreamInvite as jest.Mock).mock.calls[0][1].watchLinks).toEqual([]);
    });

    it('does not even try a platform whose scheduling window the start time is beyond, and says why', async () => {
      const { service, providers, dests } = build();
      (providers.youtube as any).maxPrescheduleLeadMs = 7 * 86_400_000;

      const detail = await service.schedule(ACCOUNT, { ...withPlatforms(), scheduledAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });

      expect(providers.youtube.createBroadcast).not.toHaveBeenCalled();
      expect(detail.platformWarnings).toHaveLength(1);
      expect(detail.platformWarnings![0]).toContain('up to 7 days ahead');
      expect([...dests.values()].every((r) => r.status === DestinationStatus.PENDING)).toBe(true);

      // Within the window it goes ahead.
      const near = await service.schedule(ACCOUNT, { ...withPlatforms(), scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
      expect(providers.youtube.createBroadcast).toHaveBeenCalledTimes(1);
      expect(near.platformWarnings).toEqual([]);
    });

    it('still schedules when the platform refuses, recording a warning and leaving that destination to be created at start', async () => {
      const { service, dests, providers } = build();
      providers.youtube.createBroadcast.mockRejectedValueOnce(new Error('quota exceeded'));

      const detail = await service.schedule(ACCOUNT, withPlatforms());

      expect(detail.platformWarnings).toHaveLength(1);
      expect(detail.platformWarnings![0]).toContain('YouTube');
      expect(detail.platformWarnings![0]).toContain('quota exceeded');
      const yt = [...dests.values()].find((r) => r.platformConnectionId === CONN_YT);
      expect(yt.status).toBe(DestinationStatus.PENDING);
      expect(yt.errorMessage).toBe('quota exceeded');
      expect(detail.destinations.find((d) => d.platform === 'youtube')!.onPlatform).toBe(false);
    });

    it('re-syncs title/time to the platform broadcast when the schedule is edited', async () => {
      const { service, providers } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());

      await service.update(ACCOUNT, detail.id, { title: 'Renamed', scheduledAt: new Date(Date.now() + 7_200_000).toISOString() });

      expect(providers.youtube.updateBroadcast).toHaveBeenCalledTimes(1);
      const [, id, meta] = providers.youtube.updateBroadcast.mock.calls[0] as any[];
      expect(id).toBe('youtube-bc-1');
      expect(meta).toMatchObject({ title: 'Renamed' });
    });

    it('removes a destination\'s platform broadcast when that destination is dropped', async () => {
      const { service, dests, providers } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());

      await service.update(ACCOUNT, detail.id, { destinationConnectionIds: [CONN_TW] });

      expect(providers.youtube.deleteBroadcast).toHaveBeenCalledWith(expect.anything(), 'youtube-bc-1');
      expect([...dests.values()].map((r) => r.platformConnectionId)).toEqual([CONN_TW]);
    });

    it('turning the option off removes the broadcasts from the platforms; turning it on creates the missing ones', async () => {
      const { service, providers } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());

      const off = await service.update(ACCOUNT, detail.id, { createOnPlatforms: false });
      expect(providers.youtube.deleteBroadcast).toHaveBeenCalledTimes(1);
      expect(off.precreateOnPlatforms).toBe(false);
      expect(off.destinations.every((d) => !d.onPlatform)).toBe(true);

      const on = await service.update(ACCOUNT, detail.id, { createOnPlatforms: true });
      expect(providers.youtube.createBroadcast).toHaveBeenCalledTimes(2);
      expect(on.destinations.find((d) => d.platform === 'youtube')!.onPlatform).toBe(true);
    });

    it('cancel and delete both remove the broadcast from the platform', async () => {
      const a = build();
      const first = await a.service.schedule(ACCOUNT, withPlatforms());
      await a.service.cancel(ACCOUNT, first.id);
      expect(a.providers.youtube.deleteBroadcast).toHaveBeenCalledTimes(1);

      const b = build();
      const second = await b.service.schedule(ACCOUNT, withPlatforms());
      await b.service.delete(ACCOUNT, second.id);
      expect(b.providers.youtube.deleteBroadcast).toHaveBeenCalledTimes(1);
    });

    it('a failure to delete on the platform never blocks cancelling', async () => {
      const { service, providers, streamsService } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());
      providers.youtube.deleteBroadcast.mockRejectedValueOnce(new Error('403'));

      await expect(service.cancel(ACCOUNT, detail.id)).resolves.toBeUndefined();
      expect(streamsService.end).toHaveBeenCalled();
    });
  });

  describe('thumbnail', () => {
    const withPlatforms = () => ({ ...baseDto(), createOnPlatforms: true });

    it('stores the image and sends it to broadcasts that exist on a platform that can take one', async () => {
      const { service, providers, thumbs } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());
      expect(detail.hasThumbnail).toBe(false);

      const after = await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());

      expect(after.hasThumbnail).toBe(true);
      expect(after.thumbnailUpdatedAt).toBeInstanceOf(Date);
      expect(thumbs.get(detail.id)).toMatchObject({ contentType: 'image/png', width: 1280, height: 720 });
      expect(providers.youtube.setBroadcastThumbnail).toHaveBeenCalledTimes(1); // Twitch has no broadcast yet
      const [, broadcastId, image] = providers.youtube.setBroadcastThumbnail.mock.calls[0] as any[];
      expect(broadcastId).toBe('youtube-bc-1');
      expect(image).toMatchObject({ contentType: 'image/png', width: 1280 });
      expect(after.platformWarnings).toBeUndefined();
    });

    it('rejects a non-image or too-small file and keeps the previous thumbnail', async () => {
      const { service, thumbs } = build();
      const detail = await service.schedule(ACCOUNT, baseDto());
      await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());

      await expect(service.setThumbnail(ACCOUNT, detail.id, Buffer.from('not an image at all, just text bytes'))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setThumbnail(ACCOUNT, detail.id, pngBuffer(320, 180))).rejects.toBeInstanceOf(BadRequestException);
      expect(thumbs.get(detail.id).width).toBe(1280);
    });

    it('a platform refusing the image is a warning -- the image is still saved', async () => {
      const { service, providers, thumbs } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());
      providers.youtube.setBroadcastThumbnail.mockRejectedValueOnce(new Error('403 verified channel'));

      const after = await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());

      expect(thumbs.has(detail.id)).toBe(true);
      expect(after.hasThumbnail).toBe(true);
      expect(after.platformWarnings).toHaveLength(1);
      expect(after.platformWarnings![0]).toContain('YouTube');
      expect(after.platformWarnings![0]).toContain('verified channel');
    });

    it('applies an already-saved thumbnail to a broadcast created afterwards', async () => {
      const { service, providers } = build();
      const detail = await service.schedule(ACCOUNT, baseDto()); // nothing on the platforms yet
      await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());
      expect(providers.youtube.setBroadcastThumbnail).not.toHaveBeenCalled();

      await service.update(ACCOUNT, detail.id, { createOnPlatforms: true });

      expect(providers.youtube.createBroadcast).toHaveBeenCalledTimes(1);
      expect(providers.youtube.setBroadcastThumbnail).toHaveBeenCalledTimes(1);
    });

    it('serves the stored image to its owner only, and 404s when there is none', async () => {
      const { service } = build();
      const detail = await service.schedule(ACCOUNT, baseDto());
      await expect(service.getThumbnail(ACCOUNT, detail.id)).rejects.toBeInstanceOf(NotFoundException);

      await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());
      const got = await service.getThumbnail(ACCOUNT, detail.id);
      expect(got.contentType).toBe('image/png');
      expect(got.data.length).toBe(40);
      await expect(service.getThumbnail({ id: 'someone_else' } as any, detail.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removing it deletes the saved image and says the platform copy cannot be removed via the API', async () => {
      const { service, thumbs } = build();
      const detail = await service.schedule(ACCOUNT, withPlatforms());
      await service.setThumbnail(ACCOUNT, detail.id, pngBuffer());

      const after = await service.removeThumbnail(ACCOUNT, detail.id);

      expect(thumbs.has(detail.id)).toBe(false);
      expect(after.hasThumbnail).toBe(false);
      expect(after.platformWarnings![0]).toContain("can't be removed");
    });

    it('cannot be changed once the stream has started', async () => {
      const { service, streams } = build();
      const detail = await service.schedule(ACCOUNT, baseDto());
      streams.get(detail.id).status = StreamStatus.LIVE;
      await expect(service.setThumbnail(ACCOUNT, detail.id, pngBuffer())).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
