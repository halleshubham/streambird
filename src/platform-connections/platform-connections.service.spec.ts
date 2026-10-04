import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { GoogleOAuthService } from '../auth/google-oauth.service';
import { Platform } from '../common/enums/platform.enum';

describe('PlatformConnectionsService', () => {
  let service: PlatformConnectionsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let destinationsRepo: { count: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let googleOAuth: { revokeToken: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'conn_1', ...v })),
    };
    destinationsRepo = { count: jest.fn().mockResolvedValue(0) };
    encryption = {
      encrypt: jest.fn(() => Buffer.from('ciphertext')),
      // The test "ciphertexts" are just the JSON of the credentials.
      decrypt: jest.fn((blob: Buffer) => JSON.parse(blob.toString())),
    };
    googleOAuth = { revokeToken: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConnectionsService,
        { provide: getRepositoryToken(PlatformConnection), useValue: repo },
        { provide: getRepositoryToken(LiveStreamDestination), useValue: destinationsRepo },
        { provide: EncryptionService, useValue: encryption },
        { provide: GoogleOAuthService, useValue: googleOAuth },
      ],
    }).compile();
    service = moduleRef.get(PlatformConnectionsService);
  });

  it('lists only active connections for the given account', async () => {
    repo.find.mockResolvedValue([{ id: 'c1' }]);
    const result = await service.findAllForAccount('acc_1');

    expect(repo.find).toHaveBeenCalledWith({
      where: { accountId: 'acc_1', isActive: true },
    });
    expect(result).toEqual([{ id: 'c1' }]);
  });

  it('hard-deletes a connection scoped to the requesting account when it has no stream history', async () => {
    repo.findOne.mockResolvedValue({ id: 'c1', accountId: 'acc_1', isActive: true });
    destinationsRepo.count.mockResolvedValue(0);

    await service.remove('c1', 'acc_1');

    expect(destinationsRepo.count).toHaveBeenCalledWith({ where: { platformConnectionId: 'c1' } });
    expect(repo.delete).toHaveBeenCalledWith({ id: 'c1', accountId: 'acc_1' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('deactivates instead of hard-deleting a connection that has stream history -- avoids the ON DELETE RESTRICT FK violation', async () => {
    const connection = { id: 'c1', accountId: 'acc_1', isActive: true };
    repo.findOne.mockResolvedValue(connection);
    destinationsRepo.count.mockResolvedValue(2);

    await service.remove('c1', 'acc_1');

    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', isActive: false }));
  });

  it('throws NotFoundException when the connection does not belong to (or does not exist for) the requesting account', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove('c1', 'acc_1')).rejects.toBeInstanceOf(NotFoundException);
    expect(destinationsRepo.count).not.toHaveBeenCalled();
  });

  it('createManualTwitchConnection encrypts the pasted ingest URL/key and stores it as a Twitch connection', async () => {
    const connection = await service.createManualTwitchConnection('acc_1', {
      label: 'My Twitch',
      ingestServerUrl: 'rtmp://live.twitch.tv/app',
      streamKey: 'live_123_abc',
    });

    expect(encryption.encrypt).toHaveBeenCalledWith({
      accessToken: '',
      refreshToken: '',
      ingestServerUrl: 'rtmp://live.twitch.tv/app',
      streamKey: 'live_123_abc',
    });

    const saved = repo.create.mock.calls[0][0];
    expect(saved.accountId).toBe('acc_1');
    expect(saved.platform).toBe(Platform.TWITCH);
    expect(saved.label).toBe('My Twitch');
    expect(saved.credentialsCiphertext).toEqual(Buffer.from('ciphertext'));
    expect(saved.externalAccountId).toEqual(expect.any(String));

    expect(connection.id).toBe('conn_1');
  });

  it('upsertYouTubeConnection creates a new connection when none exists for that channel yet', async () => {
    repo.findOne.mockResolvedValue(null);

    const connection = await service.upsertYouTubeConnection(
      'acc_1',
      { channelId: 'yt_channel_1', channelTitle: 'My Channel' },
      { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 },
    );

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { accountId: 'acc_1', platform: Platform.YOUTUBE, externalAccountId: 'yt_channel_1' },
    });
    expect(encryption.encrypt).toHaveBeenCalledWith({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 123,
      channelId: 'yt_channel_1',
    });
    const saved = repo.create.mock.calls[0][0];
    expect(saved.platform).toBe(Platform.YOUTUBE);
    expect(saved.externalAccountId).toBe('yt_channel_1');
    expect(saved.label).toBe('My Channel');
    expect(connection.id).toBe('conn_1');
  });

  it('upsertYouTubeConnection updates the existing row in place on a reconnect, rather than duplicating it', async () => {
    const existing = {
      id: 'conn_existing',
      accountId: 'acc_1',
      platform: Platform.YOUTUBE,
      externalAccountId: 'yt_channel_1',
      label: 'Old title',
      isActive: false,
    };
    repo.findOne.mockResolvedValue(existing);

    await service.upsertYouTubeConnection(
      'acc_1',
      { channelId: 'yt_channel_1', channelTitle: 'New title' },
      { accessToken: 'at2', refreshToken: 'rt2', expiresAt: 456 },
    );

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn_existing', label: 'New title', isActive: true }),
    );
  });

  it('upsertFacebookConnection creates a new connection when none exists for that Page yet', async () => {
    repo.findOne.mockResolvedValue(null);

    const connection = await service.upsertFacebookConnection(
      'acc_1',
      { pageId: 'fb_page_1', pageName: 'My Page' },
      'page-access-token',
    );

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { accountId: 'acc_1', platform: Platform.FACEBOOK, externalAccountId: 'fb_page_1' },
    });
    expect(encryption.encrypt).toHaveBeenCalledWith({
      pageAccessToken: 'page-access-token',
      pageId: 'fb_page_1',
    });
    const saved = repo.create.mock.calls[0][0];
    expect(saved.platform).toBe(Platform.FACEBOOK);
    expect(saved.externalAccountId).toBe('fb_page_1');
    expect(saved.label).toBe('My Page');
    expect(connection.id).toBe('conn_1');
  });

  it('upsertFacebookConnection updates the existing row in place on a reconnect, rather than duplicating it', async () => {
    const existing = {
      id: 'conn_existing',
      accountId: 'acc_1',
      platform: Platform.FACEBOOK,
      externalAccountId: 'fb_page_1',
      label: 'Old name',
      isActive: false,
    };
    repo.findOne.mockResolvedValue(existing);

    await service.upsertFacebookConnection(
      'acc_1',
      { pageId: 'fb_page_1', pageName: 'New name' },
      'new-page-access-token',
    );

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn_existing', label: 'New name', isActive: true }),
    );
  });

  describe('disconnecting wipes credentials and revokes access', () => {
    const creds = (refreshToken: string) => Buffer.from(JSON.stringify({ accessToken: 'at', refreshToken, expiresAt: 1, channelId: 'ch' }));
    const youtube = (id: string, refreshToken: string, extra: object = {}) => ({
      id,
      accountId: 'acc_1',
      platform: Platform.YOUTUBE,
      isActive: true,
      credentialsCiphertext: creds(refreshToken),
      ...extra,
    });

    it('revokes the YouTube refresh token at Google and blanks the stored credentials of a connection with stream history', async () => {
      const connection = youtube('c1', 'rt_1');
      repo.findOne.mockResolvedValue(connection);
      repo.find.mockResolvedValue([connection]); // only itself is active
      destinationsRepo.count.mockResolvedValue(3);

      await service.remove('c1', 'acc_1');

      expect(googleOAuth.revokeToken).toHaveBeenCalledWith('rt_1');
      expect(repo.delete).not.toHaveBeenCalled();
      const saved = repo.save.mock.calls[0][0];
      expect(saved.isActive).toBe(false);
      expect(saved.credentialsCiphertext).toEqual(Buffer.alloc(0));
      expect(saved.credentialsCiphertext.length).toBe(0);
    });

    it('also revokes before hard-deleting a connection that was never used', async () => {
      const connection = youtube('c1', 'rt_1');
      repo.findOne.mockResolvedValue(connection);
      repo.find.mockResolvedValue([connection]);
      destinationsRepo.count.mockResolvedValue(0);

      await service.remove('c1', 'acc_1');

      expect(googleOAuth.revokeToken).toHaveBeenCalledWith('rt_1');
      expect(repo.delete).toHaveBeenCalledWith({ id: 'c1', accountId: 'acc_1' });
    });

    it('does not revoke a token another active connection stores too (it would break that one), but still wipes its own copy', async () => {
      const connection = youtube('c1', 'rt_shared');
      const other = youtube('c2', 'rt_shared', { accountId: 'acc_2' });
      repo.findOne.mockResolvedValue(connection);
      repo.find.mockResolvedValue([connection, other]);
      destinationsRepo.count.mockResolvedValue(1);

      await service.remove('c1', 'acc_1');

      expect(googleOAuth.revokeToken).not.toHaveBeenCalled();
      expect(repo.save.mock.calls[0][0].credentialsCiphertext.length).toBe(0);
    });

    it('revokes when the other connections hold different tokens', async () => {
      const connection = youtube('c1', 'rt_1');
      repo.findOne.mockResolvedValue(connection);
      repo.find.mockResolvedValue([connection, youtube('c2', 'rt_other'), youtube('c3', 'rt_x', { credentialsCiphertext: Buffer.alloc(0) })]);
      destinationsRepo.count.mockResolvedValue(1);

      await service.remove('c1', 'acc_1');

      expect(googleOAuth.revokeToken).toHaveBeenCalledWith('rt_1');
    });

    it('a failed revocation never blocks the disconnect -- the credentials are still wiped', async () => {
      const connection = youtube('c1', 'rt_1');
      repo.findOne.mockResolvedValue(connection);
      repo.find.mockResolvedValue([connection]);
      destinationsRepo.count.mockResolvedValue(1);
      googleOAuth.revokeToken.mockRejectedValue(new Error('Google is down'));
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await expect(service.remove('c1', 'acc_1')).resolves.toBeUndefined();

      expect(repo.save.mock.calls[0][0]).toMatchObject({ isActive: false });
      expect(repo.save.mock.calls[0][0].credentialsCiphertext.length).toBe(0);
    });

    it('wipes Facebook and Twitch credentials too, with no call to Google', async () => {
      for (const platform of [Platform.FACEBOOK, Platform.TWITCH]) {
        repo.save.mockClear();
        repo.findOne.mockResolvedValue({
          id: 'c9',
          accountId: 'acc_1',
          platform,
          isActive: true,
          credentialsCiphertext: Buffer.from(JSON.stringify({ pageAccessToken: 'secret', streamKey: 'secret' })),
        });
        destinationsRepo.count.mockResolvedValue(2);

        await service.remove('c9', 'acc_1');

        expect(googleOAuth.revokeToken).not.toHaveBeenCalled();
        expect(repo.save.mock.calls[0][0].credentialsCiphertext.length).toBe(0);
      }
    });

    it('an already-wiped connection is simply deactivated again without touching Google', async () => {
      repo.findOne.mockResolvedValue(youtube('c1', 'rt_1', { isActive: false, credentialsCiphertext: Buffer.alloc(0) }));
      destinationsRepo.count.mockResolvedValue(1);

      await service.remove('c1', 'acc_1');

      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(googleOAuth.revokeToken).not.toHaveBeenCalled();
    });
  });
});
