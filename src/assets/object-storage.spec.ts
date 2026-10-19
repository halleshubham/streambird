import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MemoryObjectStorage, R2ObjectStorage } from './object-storage';

describe('R2ObjectStorage', () => {
  const settings = { accountId: 'acct123', accessKeyId: 'k', secretAccessKey: 's', bucket: 'brand' };
  let send: jest.SpyInstance;
  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send');
  });
  afterEach(() => send.mockRestore());

  it('puts, gets and deletes in the configured bucket', async () => {
    send.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      return {};
    });
    const r2 = new R2ObjectStorage(settings);
    await r2.put('acct/1/assets/a', Buffer.from('x'), 'image/png');
    expect((send.mock.calls[0][0] as PutObjectCommand).input).toMatchObject({ Bucket: 'brand', Key: 'acct/1/assets/a', ContentType: 'image/png' });
    expect(await r2.get('acct/1/assets/a')).toEqual(Buffer.from([1, 2, 3]));
    await r2.delete('acct/1/assets/a');
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('a missing object is null; any other failure is raised', async () => {
    const r2 = new R2ObjectStorage(settings);
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey' }));
    expect(await r2.get('missing')).toBeNull();
    send.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'ServiceUnavailable' }));
    await expect(r2.get('k')).rejects.toThrow('down');
  });
});

describe('MemoryObjectStorage', () => {
  it('round-trips and deletes', async () => {
    const m = new MemoryObjectStorage();
    await m.put('a', Buffer.from('hi'), 'image/png');
    expect((await m.get('a'))?.toString()).toBe('hi');
    await m.delete('a');
    expect(await m.get('a')).toBeNull();
  });
});
