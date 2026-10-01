import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { EncryptionService } from '../encryption/encryption.service';
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
  let encryption: { encrypt: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'conn_1', ...v })),
    };
    destinationsRepo = { count: jest.fn().mockResolvedValue(0) };
    encryption = { encrypt: jest.fn(() => Buffer.from('ciphertext')) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConnectionsService,
        { provide: getRepositoryToken(PlatformConnection), useValue: repo },
        { provide: getRepositoryToken(LiveStreamDestination), useValue: destinationsRepo },
        { provide: EncryptionService, useValue: encryption },
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
});
