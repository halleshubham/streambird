import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const keyBase64 = crypto.randomBytes(32).toString('base64');
    const moduleRef = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: { get: () => keyBase64 },
        },
      ],
    }).compile();

    service = moduleRef.get(EncryptionService);
    service.onModuleInit();
  });

  it('round-trips a plaintext object through encrypt/decrypt', () => {
    const original = { accessToken: 'abc123', refreshToken: 'xyz789' };
    const blob = service.encrypt(original);
    const decrypted = service.decrypt<typeof original>(blob);
    expect(decrypted).toEqual(original);
  });

  it('produces a different ciphertext on each call (random nonce)', () => {
    const original = { streamKey: 'live_abc' };
    const blobA = service.encrypt(original);
    const blobB = service.encrypt(original);
    expect(blobA.equals(blobB)).toBe(false);
  });

  it('fails to decrypt when the ciphertext has been tampered with', () => {
    const blob = service.encrypt({ secret: 'do-not-touch' });
    const tampered = Buffer.from(blob);
    // Flip a byte in the middle of the ciphertext region.
    tampered[20] = tampered[20] ^ 0xff;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt when the auth tag has been tampered with', () => {
    const blob = service.encrypt({ secret: 'do-not-touch' });
    const tampered = Buffer.from(blob);
    const lastByteIndex = tampered.length - 1;
    tampered[lastByteIndex] = tampered[lastByteIndex] ^ 0xff;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects a blob too short to contain a nonce and auth tag', () => {
    expect(() => service.decrypt(Buffer.from('short'))).toThrow(
      'Ciphertext blob is too short to be valid',
    );
  });
});
