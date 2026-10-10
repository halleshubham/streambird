import { buildLoginCodeEmail } from './login-code.template';

describe('buildLoginCodeEmail', () => {
  it('puts the code in the subject (readable from the notification), the text and a big code box', () => {
    const { subject, text, html } = buildLoginCodeEmail({ code: '482913' });
    expect(subject).toBe('482913 is your StreamBird login code');
    expect(text).toContain('Your StreamBird login code is 482913. It expires in 10 minutes.');
    expect(html).toContain('>482913</div>');
    expect(html).toContain('Expires in 10 minutes');
    expect(html).toContain('YOUR LOGIN CODE');
    expect(html).toContain('/icon-192.png');
  });

  it('has no link to click: a login code email must not train people to click', () => {
    const { html } = buildLoginCodeEmail({ code: '000000' });
    expect(html.match(/href="https?:\/\/[^"]*"/g) ?? []).toEqual(['href="https://streambird.app"']); // only the logo/brand link in the header
    expect(html).not.toContain('Log in');
  });

  it('repeats the code in the preheader and escapes it', () => {
    expect(buildLoginCodeEmail({ code: '123456' }).html).toContain('Your code: 123456. It expires in 10 minutes.');
    expect(buildLoginCodeEmail({ code: '<b>1</b>' }).html).not.toContain('<b>1</b>');
  });
});
