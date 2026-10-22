import { RegistrationSettingsService } from './registration-settings.service';

describe('RegistrationSettingsService', () => {
  const make = (stored?: unknown) => {
    const repo = {
      findOne: jest.fn(async () => (stored === undefined ? null : { key: 'auto_approve_registrations', value: stored })),
      save: jest.fn(async (v: unknown) => v),
    };
    return { svc: new RegistrationSettingsService(repo as any), repo };
  };

  it('is off unless the stored value is exactly true', async () => {
    expect(await make().svc.isAutoApprove()).toBe(false);
    expect(await make(false).svc.isAutoApprove()).toBe(false);
    expect(await make('true').svc.isAutoApprove()).toBe(false);
    expect(await make(true).svc.isAutoApprove()).toBe(true);
  });

  it('saves the switch under its own key', async () => {
    const { svc, repo } = make();
    await svc.setAutoApprove(true);
    expect(repo.save).toHaveBeenCalledWith({ key: 'auto_approve_registrations', value: true });
  });
});
