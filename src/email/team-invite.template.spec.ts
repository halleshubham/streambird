import { buildTeamInviteEmail } from './team-invite.template';

describe('buildTeamInviteEmail', () => {
  it('keeps the subject, tells them to just log in, and links to the login page', () => {
    const { subject, text, html } = buildTeamInviteEmail({ companyName: 'Acme Media', baseUrl: 'https://streambird.test' });
    expect(subject).toBe("You've been invited to join Acme Media on StreamBird");
    expect(text).toContain("You've been added to Acme Media's StreamBird account");
    expect(text).toContain('https://streambird.test/login');
    expect(html).toContain("YOU'RE INVITED".replace("'", '&#39;'));
    expect(html).toContain('href="https://streambird.test/login"');
    expect(html).toContain('No invite link to find.');
  });

  it('escapes a company name someone typed', () => {
    const { html } = buildTeamInviteEmail({ companyName: '<script>x</script> & Sons' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Sons');
  });
});
