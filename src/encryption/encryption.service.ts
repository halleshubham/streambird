import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * AES-256-GCM envelope encryption for credentials at rest.
 * Stored blob layout: nonce(12) || ciphertext || authTag(16).
 * A single service-wide data key is proportionate for this scale; if the
 * key ever needs to come from a KMS unwrap instead of env, only the
 * constructor changes — call sites stay the same.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const base64Key = this.config.get<string>('encryptionKeyBase64');
    if (!base64Key) {
      throw new Error('ENCRYPTION_KEY_BASE64 is not set');
    }
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY_BASE64 must decode to 32 bytes, got ${key.length}`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: unknown): Buffer {
    const nonce = crypto.randomBytes(NONCE_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([nonce, ciphertext, authTag]);
  }

  decrypt<T>(blob: Buffer): T {
    if (blob.length < NONCE_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Ciphertext blob is too short to be valid');
    }
    const nonce = blob.subarray(0, NONCE_LENGTH);
    const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(NONCE_LENGTH, blob.length - AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  }
}
