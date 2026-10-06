import { GLITCH_DEBOUNCE_MS, GLITCH_WINDOW_MS, GlitchRecoveryService } from './glitch-recovery.service';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';

const STREAM_ID = '11111111-1111-4111-8111-111111111111';

describe('GlitchRecoveryService', () => {
  let paths: Map<string, boolean> | null;
  let mediaMtx: { listPaths: jest.Mock; startSlate: jest.Mock; stopSlate: jest.Mock };
  let streamsService: { end: jest.Mock };
  let stream: any;
  let service: GlitchRecoveryService;

  beforeEach(() => {
    paths = new Map();
    mediaMtx = {
      listPaths: jest.fn(async () => paths),
      startSlate: jest.fn(async () => true),
      stopSlate: jest.fn(async () => undefined),
    };
    streamsService = { end: jest.fn(async () => undefined) };
    stream = {
      id: STREAM_ID,
      accountId: 'acc_1',
      status: StreamStatus.LIVE,
      relayLiveInputId: null,
      destinations: [
        { status: DestinationStatus.LIVE, ingestUrl: 'rtmp://live.twitch.tv/app/', streamKey: 'k1' },
        { status: DestinationStatus.FAILED, ingestUrl: 'rtmp://bad/app', streamKey: 'k2' },
      ],
    };
    const repo = { findOne: jest.fn(async () => stream) };
    service = new GlitchRecoveryService(mediaMtx as any, streamsService as any, repo as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  async function publishThenDrop(t0 = 1_000_000) {
    paths = new Map([[STREAM_ID, true]]);
    await service.tick(t0);
    paths = new Map();
    return t0;
  }

  it('does not treat a stream that never published as a glitch', async () => {
    paths = new Map();
    await service.tick(0);
    await service.tick(GLITCH_WINDOW_MS * 2);
    expect(mediaMtx.startSlate).not.toHaveBeenCalled();
    expect(service.isWatching(STREAM_ID)).toBe(false);
  });

  it('waits out the debounce, then starts the slate on every non-failed destination', async () => {
    const t0 = await publishThenDrop();
    await service.tick(t0 + GLITCH_DEBOUNCE_MS - 1);
    expect(mediaMtx.startSlate).not.toHaveBeenCalled();

    await service.tick(t0 + GLITCH_DEBOUNCE_MS);
    expect(mediaMtx.startSlate).toHaveBeenCalledWith(STREAM_ID, ['rtmp://live.twitch.tv/app/k1'], 'landscape');
  });

  it("uses the portrait slate for a vertical stream, so the video size doesn't change mid-broadcast", async () => {
    stream.orientation = 'portrait';
    const t0 = await publishThenDrop();
    await service.tick(t0 + GLITCH_DEBOUNCE_MS);
    expect(mediaMtx.startSlate).toHaveBeenCalledWith(STREAM_ID, ['rtmp://live.twitch.tv/app/k1'], 'portrait');
  });

  it('stops the slate and resumes when the publisher comes back within the window', async () => {
    const t0 = await publishThenDrop();
    await service.tick(t0 + GLITCH_DEBOUNCE_MS);

    paths = new Map([[STREAM_ID, true]]);
    await service.tick(t0 + GLITCH_DEBOUNCE_MS + 2_000);

    expect(mediaMtx.stopSlate).toHaveBeenCalledWith(STREAM_ID);
    expect(streamsService.end).not.toHaveBeenCalled();
    expect(service.isWatching(STREAM_ID)).toBe(true);
  });

  it('ends the stream once the 5 minute window passes with no publisher', async () => {
    const t0 = await publishThenDrop();
    const glitchAt = t0 + GLITCH_DEBOUNCE_MS;
    await service.tick(glitchAt);

    await service.tick(glitchAt + GLITCH_WINDOW_MS - 1);
    expect(streamsService.end).not.toHaveBeenCalled();

    await service.tick(glitchAt + GLITCH_WINDOW_MS);
    expect(streamsService.end).toHaveBeenCalledWith(STREAM_ID, 'acc_1');
    expect(service.isWatching(STREAM_ID)).toBe(false);
  });

  it('does not show a slate for a stream the host already ended with End stream', async () => {
    const t0 = await publishThenDrop();
    stream.status = StreamStatus.ENDED;
    await service.tick(t0 + GLITCH_DEBOUNCE_MS);

    expect(mediaMtx.startSlate).not.toHaveBeenCalled();
    expect(service.isWatching(STREAM_ID)).toBe(false);
  });

  it('never acts when MediaMTX cannot be reached', async () => {
    const t0 = await publishThenDrop();
    paths = null;
    await service.tick(t0 + GLITCH_WINDOW_MS * 2);
    expect(mediaMtx.startSlate).not.toHaveBeenCalled();
    expect(streamsService.end).not.toHaveBeenCalled();
  });

  it('after a restart, adopts a running slate for a live stream and removes one for an ended stream', async () => {
    paths = new Map([[`${STREAM_ID}-slate`, false]]);
    await service.tick(5_000);
    expect(service.isWatching(STREAM_ID)).toBe(true);

    const fresh = new GlitchRecoveryService(
      mediaMtx as any,
      streamsService as any,
      { findOne: jest.fn(async () => ({ ...stream, status: StreamStatus.ENDED })) } as any,
    );
    jest.spyOn((fresh as any).logger, 'warn').mockImplementation(() => undefined);
    await fresh.tick(5_000);
    expect(fresh.isWatching(STREAM_ID)).toBe(false);
    expect(mediaMtx.stopSlate).toHaveBeenCalledWith(STREAM_ID);
  });
});
