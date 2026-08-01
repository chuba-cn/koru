import { describe, expect, it } from 'vitest';
import {
  renderInviteEmail,
  renderResetPasswordEmail,
  renderStaffRemovedEmail,
  renderVerificationEmail,
  renderWelcomeEmail,
} from './index.js';

const BRAND = {
  logoUrl: 'https://koru.ng/logo.png',
  supportEmail: 'support@koru.ng',
  supportPhone: '+234 706 079 9114',
};

function expectBrandFooter(html: string) {
  expect(html).toContain(BRAND.logoUrl);
  expect(html).toContain(BRAND.supportEmail);
  expect(html).toContain(BRAND.supportPhone);
}

describe('renderVerificationEmail', () => {
  it('includes the verification link and the brand footer', async () => {
    const html = await renderVerificationEmail('https://koru.ng/verify?token=abc', BRAND);
    expect(html).toContain('https://koru.ng/verify?token=abc');
    expectBrandFooter(html);
  });
});

describe('renderResetPasswordEmail', () => {
  it('includes the reset link and the brand footer', async () => {
    const html = await renderResetPasswordEmail('https://koru.ng/reset?token=xyz', BRAND);
    expect(html).toContain('https://koru.ng/reset?token=xyz');
    expectBrandFooter(html);
  });
});

describe('renderInviteEmail', () => {
  it('includes the church name, invite link, and the brand footer', async () => {
    const html = await renderInviteEmail(
      'Celebration Church',
      'https://koru.ng/invite?token=1',
      BRAND,
    );
    expect(html).toContain('Celebration Church');
    expect(html).toContain('https://koru.ng/invite?token=1');
    expectBrandFooter(html);
  });

  it('escapes HTML in an untrusted church name rather than injecting it raw', async () => {
    const html = await renderInviteEmail(
      '<img src=x onerror=alert(1)>',
      'https://koru.ng/invite?token=1',
      BRAND,
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('renderWelcomeEmail', () => {
  it('includes the church name and the brand footer', async () => {
    const html = await renderWelcomeEmail('Celebration Church', BRAND);
    expect(html).toContain('Celebration Church');
    expectBrandFooter(html);
  });
});

describe('renderStaffRemovedEmail', () => {
  it('includes the church name and the brand footer', async () => {
    const html = await renderStaffRemovedEmail('Celebration Church', BRAND);
    expect(html).toContain('Celebration Church');
    expectBrandFooter(html);
  });
});
