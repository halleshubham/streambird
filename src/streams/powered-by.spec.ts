import { POWERED_BY_LINE, withPoweredBy } from './powered-by';

describe('withPoweredBy', () => {
  it('adds the line after a blank line, or alone when there is no description', () => {
    expect(withPoweredBy('Our weekly show')).toBe(`Our weekly show\n\n${POWERED_BY_LINE}`);
    expect(withPoweredBy(undefined)).toBe(POWERED_BY_LINE);
    expect(withPoweredBy('  ')).toBe(POWERED_BY_LINE);
    expect(POWERED_BY_LINE).toContain('streambird.app');
  });
  it('never adds it twice', () => {
    const once = withPoweredBy('Hi');
    expect(withPoweredBy(once)).toBe(once);
    expect(withPoweredBy('Made on https://streambird.app')).toBe('Made on https://streambird.app');
  });
});
