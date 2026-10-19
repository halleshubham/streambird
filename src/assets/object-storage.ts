import { Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Where uploaded brand files (logos, wallpapers, pictures) are kept. Keys look like `acct/<accountId>/assets/<assetId>`. */
export interface ObjectStorage {
  /** False = no storage is configured (production without R2 credentials): uploads are refused with a clear message. */
  readonly enabled: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Cloudflare R2 through its S3-compatible API. The bucket stays private: every read goes through this backend. */
export class R2ObjectStorage implements ObjectStorage {
  readonly enabled = true;
  private readonly logger = new Logger(R2ObjectStorage.name);
  private readonly client: S3Client;

  constructor(private readonly settings: R2Settings) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      this.logger.error(`R2 get ${key} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }
}

/** In-process storage for development and tests (nothing survives a restart). Never used in production. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly enabled = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** Production without R2 credentials: the feature reports itself as off instead of failing mysteriously. */
export class DisabledObjectStorage implements ObjectStorage {
  readonly enabled = false;
  async put(): Promise<void> {
    throw new Error('Asset storage is not configured');
  }
  async get(): Promise<Buffer | null> {
    throw new Error('Asset storage is not configured');
  }
  async delete(): Promise<void> {
    throw new Error('Asset storage is not configured');
  }
}
