import * as crypto from 'crypto';

// Zero-dependency password hashing (no bcrypt/bcryptjs dependency exists in
// this codebase -- see package.json -- and scrypt's built-in cost
// parameters give adequate offline-brute-force resistance for the small,
// fixed set of Superadmin identities this is used for). Stored format:
// "<salt-hex>:<derived-key-hex>", mirroring EncryptionService's
// self-describing-blob convention elsewhere in this codebase.
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  const storedBuf = Buffer.from(hash, 'hex');
  if (storedBuf.length !== derived.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedBuf, derived);
}
