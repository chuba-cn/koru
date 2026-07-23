import { afterEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  send.mockReset();
});

describe('ConsoleMailSender (via the exported mailSender singleton)', () => {
  it('logs the send and records it in the tail for tests to read back', async () => {
    // Cleared explicitly rather than trusting their absence — env.ts loads a real
    // .env via dotenv, and a developer's local file may genuinely set these.
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('MAIL_FROM', '');
    vi.resetModules();
    const { mailSender } = await import('./mail-sender.js');

    await mailSender.send('ada@example.test', 'Welcome', '<p>Hi Ada</p>');

    expect(mailSender.lastSentTo?.('ada@example.test')).toMatchObject({
      to: 'ada@example.test',
      subject: 'Welcome',
      html: '<p>Hi Ada</p>',
    });
  });

  it('refuses to run in production', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('MAIL_FROM', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { mailSender } = await import('./mail-sender.js');

    await expect(mailSender.send('ada@example.test', 'X', '<p>X</p>')).rejects.toThrow(
      /must not run in production/,
    );
  });

  it('fails to boot if exactly one of RESEND_API_KEY/MAIL_FROM is set', async () => {
    vi.stubEnv('RESEND_API_KEY', 'only-one');
    vi.stubEnv('MAIL_FROM', '');
    vi.resetModules();

    await expect(import('./mail-sender.js')).rejects.toThrow(/MAIL_FROM is missing/);
  });
});

describe('ResendMailSender', () => {
  it('sends the request shape Resend expects, including the idempotency key as a second argument', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('MAIL_FROM', 'KORU <no-reply@koru.test>');
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    vi.resetModules();

    const { mailSender } = await import('./mail-sender.js');
    await mailSender.send('ada@example.test', 'Welcome', '<p>Hi</p>', 'idem-key-1');

    expect(send).toHaveBeenCalledWith(
      {
        from: 'KORU <no-reply@koru.test>',
        to: 'ada@example.test',
        subject: 'Welcome',
        html: '<p>Hi</p>',
      },
      { idempotencyKey: 'idem-key-1' },
    );
  });

  it('throws when Resend returns an error rather than a network-level failure', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('MAIL_FROM', 'KORU <no-reply@koru.test>');
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'bad from' },
    });
    vi.resetModules();

    const { mailSender } = await import('./mail-sender.js');

    await expect(mailSender.send('ada@example.test', 'Welcome', '<p>Hi</p>')).rejects.toThrow(
      /validation_error/,
    );
  });
});
