import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBrandKitDto, UpdateBrandKitDto, isKnownTimeZone } from './brand-kit.dto';

/** The same options the app's global ValidationPipe uses (whitelist + forbidNonWhitelisted + transform). */
const errorsOf = (cls: typeof CreateBrandKitDto | typeof UpdateBrandKitDto, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls as never, body) as object, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) => Object.values(e.constraints ?? {}));

describe('brand kit clock fields', () => {
  const base = { name: 'Kit' };

  it('all seven fields are optional on create and update (omitted = default / unchanged)', () => {
    expect(errorsOf(CreateBrandKitDto, base)).toEqual([]);
    expect(errorsOf(UpdateBrandKitDto, {})).toEqual([]);
  });

  it('accepts every valid value', () => {
    for (const clockPosition of ['top_left', 'top_right', 'bottom_left', 'bottom_right']) expect(errorsOf(UpdateBrandKitDto, { clockPosition })).toEqual([]);
    for (const clockFormat of ['12h', '24h']) expect(errorsOf(UpdateBrandKitDto, { clockFormat })).toEqual([]);
    for (const clockSize of ['small', 'medium', 'large']) expect(errorsOf(UpdateBrandKitDto, { clockSize })).toEqual([]);
    expect(errorsOf(UpdateBrandKitDto, { clockEnabled: true, clockShowDate: false, clockShowSeconds: true, clockTimezone: 'Asia/Kolkata' })).toEqual([]);
  });

  it('refuses bad values with a plain sentence', () => {
    expect(errorsOf(UpdateBrandKitDto, { clockPosition: 'center' })).toEqual(['The clock position must be top_left, top_right, bottom_left or bottom_right.']);
    expect(errorsOf(UpdateBrandKitDto, { clockFormat: '36h' })).toEqual(['The clock format must be 12h or 24h.']);
    expect(errorsOf(UpdateBrandKitDto, { clockSize: 'huge' })).toEqual(['The clock size must be small, medium or large.']);
    expect(errorsOf(UpdateBrandKitDto, { clockEnabled: 'yes' })).toEqual(['The clock on/off setting must be true or false.']);
    expect(errorsOf(UpdateBrandKitDto, { clockShowDate: 1 })).toEqual(['The clock show-date setting must be true or false.']);
    expect(errorsOf(UpdateBrandKitDto, { clockShowSeconds: 'no' })).toEqual(['The clock show-seconds setting must be true or false.']);
    expect(errorsOf(CreateBrandKitDto, { ...base, clockPosition: 5 })).toHaveLength(1);
  });

  it('time zone: known IANA names pass; unknown, non-text and over-long names are refused; null and blank mean the device zone', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'UTC', 'Europe/London']) expect(errorsOf(UpdateBrandKitDto, { clockTimezone: tz })).toEqual([]);
    for (const tz of ['Mars/Olympus', 'Not a zone', 'Asia/Kolkatta', 7, true, 'A'.repeat(65)]) {
      expect(errorsOf(UpdateBrandKitDto, { clockTimezone: tz })).toHaveLength(1);
    }
    expect(errorsOf(UpdateBrandKitDto, { clockTimezone: null })).toEqual([]);
    expect(plainToInstance(UpdateBrandKitDto, { clockTimezone: '   ' }).clockTimezone).toBeNull(); // blank = the device's own zone
    expect(errorsOf(UpdateBrandKitDto, { clockTimezone: '   ' })).toEqual([]);
    expect(errorsOf(UpdateBrandKitDto, { clockTimezone: ' Asia/Kolkata ' })).toEqual([]);
    expect(plainToInstance(UpdateBrandKitDto, { clockTimezone: ' Asia/Kolkata ' }).clockTimezone).toBe('Asia/Kolkata');
  });

  it('unknown clock-like fields are still refused (whitelist)', () => {
    expect(errorsOf(UpdateBrandKitDto, { clockColour: 'red' })).toHaveLength(1);
  });

  it('isKnownTimeZone', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('')).toBe(false);
    expect(isKnownTimeZone(undefined)).toBe(false);
    expect(isKnownTimeZone('x'.repeat(64))).toBe(false);
  });
});
