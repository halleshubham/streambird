import { describeFacebookPermissions, summarizeFacebookPermissions } from './facebook-permissions';

describe('facebook permission diagnostics', () => {
  it('splits granted, declined and other permissions by name', () => {
    const s = summarizeFacebookPermissions({
      data: [
        { permission: 'public_profile', status: 'granted' },
        { permission: 'pages_show_list', status: 'declined' },
        { permission: 'pages_manage_posts', status: 'declined' },
        { permission: 'publish_video', status: 'expired' },
      ],
    });
    expect(s).toEqual({ granted: ['public_profile'], declined: ['pages_show_list', 'pages_manage_posts'], other: ['publish_video:expired'] });
    expect(describeFacebookPermissions(s)).toBe('granted: public_profile; declined: pages_show_list, pages_manage_posts; other: publish_video:expired');
  });

  it('copes with an empty or broken response', () => {
    for (const body of [null, undefined, {}, { data: 'x' }, { data: [null, { status: 'granted' }] }]) {
      expect(summarizeFacebookPermissions(body)).toEqual({ granted: [], declined: [], other: [] });
    }
    expect(describeFacebookPermissions({ granted: [], declined: [], other: [] })).toBe('granted: none; declined: none');
  });
});
