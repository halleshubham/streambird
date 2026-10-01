import { StudioSignalingGateway } from './studio-signaling.gateway';
import { StreamStatus } from '../common/enums/stream-status.enum';

describe('StudioSignalingGateway -- host-disconnect auto-end', () => {
  let gateway: StudioSignalingGateway;
  let sessionsService: {
    resolveHostToken: jest.Mock;
    recordHostJoined: jest.Mock;
    recordParticipantLeft: jest.Mock;
    findByIdWithLiveStream: jest.Mock;
  };
  let streamsService: { end: jest.Mock };

  function fakeSocket(id: string) {
    return {
      id,
      handshake: { auth: { role: 'host', sessionId: 'session_1', hostToken: 'token_1' } },
      join: jest.fn(async () => undefined),
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      disconnect: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    sessionsService = {
      resolveHostToken: jest.fn(async () => ({ studioSessionId: 'session_1' })),
      recordHostJoined: jest.fn(async () => ({ id: 'participant_1' })),
      recordParticipantLeft: jest.fn(async () => undefined),
      findByIdWithLiveStream: jest.fn(async () => ({
        liveStreamId: 'live_stream_1',
        liveStream: { accountId: 'acc_1', status: StreamStatus.LIVE },
      })),
    };
    streamsService = { end: jest.fn(async () => undefined) };
    gateway = new StudioSignalingGateway(sessionsService as any, streamsService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ends the stream once the grace period elapses with no host reconnect', async () => {
    const socket = fakeSocket('socket_1');
    await gateway.handleConnection(socket as any);
    await gateway.handleDisconnect(socket as any);

    expect(streamsService.end).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(streamsService.end).toHaveBeenCalledWith('live_stream_1', 'acc_1');
  });

  it('cancels the pending end if the host reconnects within the grace period', async () => {
    const socket1 = fakeSocket('socket_1');
    await gateway.handleConnection(socket1 as any);
    await gateway.handleDisconnect(socket1 as any);

    jest.advanceTimersByTime(30_000); // halfway through the grace window
    const socket2 = fakeSocket('socket_2');
    await gateway.handleConnection(socket2 as any);

    jest.advanceTimersByTime(60_000); // past where the original timer would have fired
    await Promise.resolve();
    await Promise.resolve();

    expect(streamsService.end).not.toHaveBeenCalled();
  });

  it('does not end a stream that is no longer LIVE by the time the timer fires', async () => {
    sessionsService.findByIdWithLiveStream.mockResolvedValue({
      liveStreamId: 'live_stream_1',
      liveStream: { accountId: 'acc_1', status: StreamStatus.ENDED },
    });
    const socket = fakeSocket('socket_1');
    await gateway.handleConnection(socket as any);
    await gateway.handleDisconnect(socket as any);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(streamsService.end).not.toHaveBeenCalled();
  });

  it('never schedules an end for a guest disconnecting', async () => {
    const socket = {
      id: 'socket_1',
      handshake: { auth: { role: 'guest', token: 'invite_token' } },
      join: jest.fn(async () => undefined),
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      disconnect: jest.fn(),
    };
    sessionsService = {
      ...sessionsService,
      // @ts-expect-error -- joinAsGuest isn't part of this spec's mocked shape elsewhere
      joinAsGuest: jest.fn(async () => ({ id: 'participant_2', studioSessionId: 'session_1' })),
    };
    gateway = new StudioSignalingGateway(sessionsService as any, streamsService as any);

    await gateway.handleConnection(socket as any);
    await gateway.handleDisconnect(socket as any);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(streamsService.end).not.toHaveBeenCalled();
  });
});
