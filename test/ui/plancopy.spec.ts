import { expect, test } from '@playwright/test';
import { monthlyHoursLabel } from '../../web-app/src/lib/planCopy';

// The streaming-time line shared by the home page and the Billing page (no browser involved).
test.describe('plan copy', () => {
  test('small allowances read as plain hours; 100+ is fair use; no hours at all is unlimited fair use', () => {
    expect(monthlyHoursLabel({ includedHoursPerMonth: 5 })).toBe('5 stream-hours/mo');
    expect(monthlyHoursLabel({ includedHoursPerMonth: 20 })).toBe('20 stream-hours/mo');
    expect(monthlyHoursLabel({ includedHoursPerMonth: 200 })).toBe('200 stream-hours/mo (fair use)');
    expect(monthlyHoursLabel({ includedHoursPerMonth: null })).toBe('Unlimited streaming (fair use)');
    expect(monthlyHoursLabel({ includedHoursPerMonth: 200 }, 'stream-hours / month')).toBe('200 stream-hours / month (fair use)');
  });
});
