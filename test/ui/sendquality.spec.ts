import { expect, test } from '@playwright/test';
import { bitrateBetween, classifySendQuality, formatBitrate, readOutboundVideo } from '../../web-app/src/studio/sendQuality';

// The send-quality classifier (pure; no browser involved).
const hd = { width: 1280, height: 720 };
const base = { width: 1280, height: 720, fps: 30, bitrateBps: 3_100_000, limitationReason: null };

test.describe('send quality classifier', () => {
  test('ok at full size with no limitation', () => {
    const q = classifySendQuality(base, hd);
    expect(q.state).toBe('ok');
    expect(q.message).toBeNull();
    expect(q.summary).toBe('Sending 1280x720 - 30 fps - 3.1 Mbps');
  });
  test('bandwidth and cpu limitation', () => {
    expect(classifySendQuality({ ...base, limitationReason: 'bandwidth' }, hd)).toMatchObject({
      state: 'limited',
      message: 'Your connection is limiting quality. Try 720p or a wired network.',
    });
    expect(classifySendQuality({ ...base, limitationReason: 'cpu' }, hd).message).toBe(
      'Your computer is struggling. Try a lower quality or close other tabs.',
    );
  });
  test('a picture below 75% of the chosen height is limited', () => {
    expect(classifySendQuality({ ...base, width: 426, height: 240 }, { width: 2560, height: 1440 }).state).toBe('limited');
    expect(classifySendQuality({ ...base, width: 960, height: 540 }, hd).state).toBe('ok');
    expect(classifySendQuality({ ...base, width: 854, height: 480 }, hd).state).toBe('limited');
  });
  test('warm-up hides the size check but not a stated reason', () => {
    expect(classifySendQuality({ ...base, width: 426, height: 240 }, hd, { warmingUp: true }).state).toBe('ok');
    expect(classifySendQuality({ ...base, width: 426, height: 240, limitationReason: 'cpu' }, hd, { warmingUp: true }).state).toBe('limited');
  });
  test('vertical streams are judged by the short side', () => {
    expect(classifySendQuality({ ...base, width: 720, height: 1280 }, { width: 720, height: 1280 }).state).toBe('ok');
    expect(classifySendQuality({ ...base, width: 240, height: 426 }, { width: 720, height: 1280 }).state).toBe('limited');
  });
  test('bitrate formatting and placeholder', () => {
    expect(formatBitrate(850_000)).toBe('850 kbps');
    expect(formatBitrate(2_000_000)).toBe('2.0 Mbps');
    expect(classifySendQuality({ ...base, bitrateBps: null }, hd).summary).toContain('-- Mbps');
  });
  test('readOutboundVideo picks the video entry, bitrateBetween uses deltas, junk never throws', () => {
    const mk = (rows: Record<string, unknown>[]) => new Map(rows.map((r, i) => [String(i), r]));
    const r = readOutboundVideo(
      mk([
        { type: 'outbound-rtp', kind: 'audio', bytesSent: 5 },
        { type: 'outbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, framesPerSecond: 24, qualityLimitationReason: 'none', bytesSent: 1000, timestamp: 1000 },
      ]),
    );
    expect(r?.sample).toEqual({ width: 640, height: 360, fps: 24, limitationReason: null });
    expect(readOutboundVideo(undefined)).toBeNull();
    expect(readOutboundVideo({})).toBeNull();
    expect(readOutboundVideo(mk([{ type: 'outbound-rtp', kind: 'video' }]))).toBeNull();
    expect(bitrateBetween({ bytesSent: 0, timestamp: 0 }, { bytesSent: 500_000, timestamp: 2000 })).toBe(2_000_000);
    expect(bitrateBetween(null, { bytesSent: 1, timestamp: 1 })).toBeNull();
  });
});
