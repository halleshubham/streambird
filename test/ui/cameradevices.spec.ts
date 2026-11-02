import { expect, test } from '@playwright/test';
import {
  buildAudioConstraints,
  buildVideoConstraints,
  describeMediaError,
  guessFacing,
  nextCamera,
  normaliseDevices,
  otherFacing,
  pickFlipTarget,
  resolveRemembered,
} from '../../web-app/src/studio/cameraDevices';

// Pure helpers behind the camera / microphone chooser (no browser involved).
const dev = (kind: string, deviceId: string, label: string) => ({ kind, deviceId, label });

test.describe('camera device helpers', () => {
  test('normaliseDevices keeps one kind, drops duplicates and the virtual default when real devices exist, names blank labels', () => {
    const list = [
      dev('videoinput', 'a', 'Front Camera'),
      dev('videoinput', 'a', 'Front Camera'),
      dev('videoinput', 'b', ''),
      dev('audioinput', 'default', 'Default - Mic'),
      dev('audioinput', 'm1', 'USB Mic'),
      dev('audiooutput', 'o1', 'Speaker'),
    ];
    expect(normaliseDevices(list, 'videoinput')).toEqual([
      { id: 'a', label: 'Front Camera' },
      { id: 'b', label: 'Camera 2' },
    ]);
    expect(normaliseDevices(list, 'audioinput')).toEqual([{ id: 'm1', label: 'USB Mic' }]);
    expect(normaliseDevices([dev('audioinput', 'default', 'Default')], 'audioinput')).toEqual([{ id: 'default', label: 'Default' }]);
  });

  test('before permission the labels and ids are empty: still a readable list', () => {
    const out = normaliseDevices([dev('videoinput', '', ''), dev('videoinput', '', '')], 'videoinput');
    expect(out.map((d) => d.label)).toEqual(['Camera 1', 'Camera 2']);
    expect(out.every((d) => d.id === '')).toBe(true);
  });

  test('resolveRemembered ignores a device that no longer exists', () => {
    const list = [{ id: 'a', label: 'A' }];
    expect(resolveRemembered('a', list)).toBe('a');
    expect(resolveRemembered('gone', list)).toBeNull();
    expect(resolveRemembered(null, list)).toBeNull();
    expect(resolveRemembered('x', [])).toBe('x'); // no list yet: cannot tell, the request itself is only "ideal"
  });

  test('guessFacing and flip targets', () => {
    expect(guessFacing('camera2 0, facing back')).toBe('environment');
    expect(guessFacing('Front Camera')).toBe('user');
    expect(guessFacing('USB Webcam')).toBeNull();
    expect(otherFacing('user')).toBe('environment');
    const cams = [
      { id: 'f', label: 'Front Camera' },
      { id: 'b', label: 'Back Camera' },
    ];
    expect(pickFlipTarget(cams, 'f', 'user')).toEqual({ id: 'b', facing: 'environment' });
    expect(pickFlipTarget(cams, 'b', 'environment')).toEqual({ id: 'f', facing: 'user' });
    expect(pickFlipTarget([{ id: 'x', label: 'Camera A' }, { id: 'y', label: 'Camera B' }], 'x', 'user')).toBeNull();
    expect(nextCamera([{ id: 'x', label: 'A' }, { id: 'y', label: 'B' }], 'y')?.id).toBe('x');
    expect(nextCamera([{ id: 'x', label: 'A' }], 'x')).toBeNull();
  });

  test('video constraints: vertical streams keep asking for a tall picture on any camera', () => {
    expect(buildVideoConstraints({ portrait: false })).toBe(true);
    expect(buildVideoConstraints({ portrait: true })).toEqual({ aspectRatio: { ideal: 9 / 16 } });
    expect(buildVideoConstraints({ portrait: true, exactId: 'b' })).toEqual({ aspectRatio: { ideal: 9 / 16 }, deviceId: { exact: 'b' } });
    expect(buildVideoConstraints({ portrait: false, idealId: 'b' })).toEqual({ deviceId: { ideal: 'b' } });
    expect(buildVideoConstraints({ portrait: false, facing: 'environment' })).toEqual({ facingMode: { exact: 'environment' } });
    expect(buildVideoConstraints({ portrait: false, exactId: 'b', facing: 'user' })).toEqual({ deviceId: { exact: 'b' } });
  });

  test('audio constraints keep the echo settings', () => {
    const base = { echoCancellation: true };
    expect(buildAudioConstraints(base, {})).toEqual(base);
    expect(buildAudioConstraints(base, { exactId: 'm' })).toEqual({ echoCancellation: true, deviceId: { exact: 'm' } });
    expect(buildAudioConstraints(base, { idealId: 'm' })).toEqual({ echoCancellation: true, deviceId: { ideal: 'm' } });
  });

  test('describeMediaError', () => {
    expect(describeMediaError({ name: 'NotAllowedError' })).toContain('blocked');
    expect(describeMediaError({ name: 'NotReadableError' })).toContain('busy');
    expect(describeMediaError({ name: 'OverconstrainedError' }, 'microphone')).toContain('microphone');
    expect(describeMediaError({ name: 'Weird', message: 'boom' })).toBe('boom');
  });
});
