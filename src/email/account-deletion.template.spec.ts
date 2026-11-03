import { buildAccountDeletedEmail, buildAccountDeletionCodeEmail } from './account-deletion.template';

describe('account deletion emails', () => {
  it('the code email names the purpose in the subject and says to ignore it if unexpected', () => {
    const { subject, text, html } = buildAccountDeletionCodeEmail({ code: '482913', baseUrl: 'https://streambird.test' });
    expect(subject).toBe('482913 is your StreamBird account deletion code');
    expect(text).toContain('permanently deletes your account');
    expect(html).toContain('482913');
    expect(html).toContain('Nothing is deleted without it');
  });

  it('the confirmation says only that it happened, in two wordings, with the support address', () => {
    const own = buildAccountDeletedEmail({ companyDeleted: false });
    const company = buildAccountDeletedEmail({ companyDeleted: true });
    expect(own.text).toContain('Your StreamBird account and the data linked to it have been deleted.');
    expect(company.text).toContain('deleted by its administrator');
    expect(own.text).toContain('support@shackyapps.in');
    expect(own.subject).toBe('Your StreamBird account was deleted');
  });
});
