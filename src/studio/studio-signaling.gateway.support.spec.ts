import { StudioSignalingGateway } from './studio-signaling.gateway';

describe('StudioSignalingGateway -- support socket bookkeeping', () => {
  const row = { studioSessionId: 'session_1', streamId: 'st', accountId: 'acc', impersonationSessionId: 'imp', adminUserId: 'adm', expiresAt: Date.now() + 60_000 };

  function build(connected: boolean) {
    const impersonation = {
      onSessionEnded: () => () => undefined,
      checkControlSession: jest.fn(async () => ({ ok: true, session: { adminUserId: 'adm', targetAccountId: 'acc' } })),
      recordStudioControl: jest.fn(async () => undefined),
    };
    const supportControl = { resolve: jest.fn(() => row), isLive: jest.fn(async () => true), revokeForSession: jest.fn(), kitBelongsTo: jest.fn() };
    const gateway = new StudioSignalingGateway({} as any, {} as any, {} as any, {} as any, impersonation as any, supportControl as any);
    (gateway as any).server = { sockets: new Map(), adapter: { rooms: new Map() }, to: () => ({ emit: jest.fn() }) };
    const socket = {
      id: 's1',
      connected,
      handshake: { auth: { role: 'support', sessionId: 'session_1', controlToken: 'tok-tok-tok-tok-tok-tok' } },
      join: jest.fn(async () => undefined),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    return { gateway, socket, impersonation };
  }

  it('a socket that dropped while the connect checks were running leaves no entry behind', async () => {
    const { gateway, socket, impersonation } = build(false);
    await gateway.handleConnection(socket as any);
    expect((gateway as any).supportSockets.size).toBe(0);
    expect(socket.join).not.toHaveBeenCalled();
    expect(impersonation.recordStudioControl).toHaveBeenLastCalledWith('impersonated_studio_control', 'adm', 'acc', expect.objectContaining({ reason: 'dropped_while_connecting' }), false);
  });

  it('a connected one is registered; a ghost (socket no longer in the namespace) is dropped by the revalidation', async () => {
    const { gateway, socket } = build(true);
    await gateway.handleConnection(socket as any);
    expect((gateway as any).supportSockets.size).toBe(1);
    await (gateway as any).revalidateSupportSockets(); // the fake namespace has no such socket
    expect((gateway as any).supportSockets.size).toBe(0);
  });

  it('a command from a socket that is not a support socket is dropped (no relay, no ack)', async () => {
    const { gateway } = build(true);
    expect(await gateway.handleSupportCommand({ id: 'guest' } as any, { id: 'x', type: 'layout.set', payload: { mode: 'grid' } })).toBeUndefined();
  });
});
