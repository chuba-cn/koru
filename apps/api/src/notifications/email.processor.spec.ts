import { describe, expect, it, vi } from 'vitest';
import { EmailProcessor } from './email.processor';
import { mailSender } from './mail-sender';

vi.mock('./mail-sender', () => ({
  mailSender: { send: vi.fn() },
}));

const LOG = {
  id: 'log-1',
  recipientEmail: 'ada@example.test',
  subject: 'Welcome',
  renderedHtml: '<p>Hi</p>',
};

function build() {
  const prisma = {
    emailLog: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve(LOG)),
      update: vi.fn(() => Promise.resolve(LOG)),
    },
  };

  return { processor: new EmailProcessor(prisma as never), prisma };
}

function jobWith(attemptsMade: number, attempts: number) {
  return { data: { emailLogId: LOG.id }, attemptsMade, opts: { attempts } } as never;
}

describe('EmailProcessor.process', () => {
  it('marks the row sent with the provider message id on success', async () => {
    const { processor, prisma } = build();
    vi.mocked(mailSender.send).mockResolvedValue('provider-msg-1');

    await processor.process(jobWith(0, 5));

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: LOG.id },
      data: { status: 'sent', sentAt: expect.any(Date), providerMessageId: 'provider-msg-1' },
    });
  });

  it('sends with the EmailLog id as the idempotency key, so a retry after a successful send never double-sends', async () => {
    const { processor } = build();
    vi.mocked(mailSender.send).mockResolvedValue('provider-msg-1');

    await processor.process(jobWith(0, 5));

    expect(mailSender.send).toHaveBeenCalledWith(
      LOG.recipientEmail,
      LOG.subject,
      LOG.renderedHtml,
      LOG.id,
    );
  });

  it('leaves the row untouched on a failed attempt that still has retries remaining', async () => {
    const { processor, prisma } = build();
    vi.mocked(mailSender.send).mockRejectedValue(new Error('temporary outage'));

    await expect(processor.process(jobWith(1, 5))).rejects.toThrow('temporary outage');

    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });

  it('marks the row failed once the final attempt is exhausted', async () => {
    const { processor, prisma } = build();
    vi.mocked(mailSender.send).mockRejectedValue(new Error('provider down'));

    await expect(processor.process(jobWith(4, 5))).rejects.toThrow('provider down');

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: LOG.id },
      data: { status: 'failed', failureReason: 'Error: provider down' },
    });
  });
});
