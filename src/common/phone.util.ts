/**
 * Turns what a person typed into E.164 ("+919876543210"), or null when it cannot be a mobile number.
 * A bare 10-digit number starting 6-9 is taken as Indian (+91), which is almost every user today; anything
 * else must carry its country code ("+" or "00" prefix), 8-15 digits in all.
 */
export function normalizePhone(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw || !/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    // keep as is
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = `91${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    // "91 98765 43210" typed without the plus
  } else {
    return null;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}
