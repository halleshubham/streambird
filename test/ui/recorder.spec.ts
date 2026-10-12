import { expect, test } from '@playwright/test';
import { formatElapsed, pickRecordingType, recordingFileName } from '../../web-app/src/studio/recorder';

// Pure helpers behind "Record to this computer" (no browser involved).

test.describe('recorder helpers', () => {
  test('prefers MP4, falls back to WebM (vp9, then vp8), and says no when nothing is supported', () => {
    expect(pickRecordingType(() => true)?.ext).toBe('mp4');
    expect(pickRecordingType((m) => m.startsWith('video/webm;codecs=vp9'))).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    expect(pickRecordingType((m) => m === 'video/webm;codecs=vp8,opus')?.ext).toBe('webm');
    expect(pickRecordingType(() => false)).toBeNull();
  });

  test('file names are safe, readable and timestamped', () => {
    const at = new Date(2026, 9, 12, 9, 5);
    expect(recordingFileName('My Show: Ep. 1!', at, 'mp4')).toBe('streambird-my-show-ep-1-2026-10-12-0905.mp4');
    expect(recordingFileName('', at, 'webm')).toBe('streambird-2026-10-12-0905.webm');
    expect(recordingFileName(undefined, at, 'webm')).toBe('streambird-2026-10-12-0905.webm');
    expect(recordingFileName('../../etc/passwd', at, 'mp4')).toBe('streambird-etc-passwd-2026-10-12-0905.mp4');
    expect(recordingFileName('x'.repeat(200), at, 'mp4').length).toBeLessThan(80);
  });

  test('the clock reads mm:ss, then h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(83.9)).toBe('01:23');
    expect(formatElapsed(3725)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });
});
