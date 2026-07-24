import { describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service';

function build(overrides: { addThrows?: boolean; updateThrows?: boolean } = {}) {
  const created = { id: 'log-1' };

  const prisma = {
    emailLog: {
      create: vi.fn(() => Promise.resolve(created)),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        overrides.updateThrows
          ? Promise.reject(new Error('db unreachable'))
          : Promise.resolve({ ...created, ...data }),
      ),
    },
  };

  const emailQueue = {
    add: vi.fn(() =>
      overrides.addThrows ? Promise.reject(new Error('redis unreachable')) : Promise.resolve(),
    ),
  };

  return {
    service: new MailService(prisma as never, emailQueue as never),
    prisma,
    emailQueue,
  };
}

describe('MailService.send', () => {
  it('writes a queued EmailLog row and enqueues a job carrying only the id', async () => {
    const { service, prisma, emailQueue } = build();

    const log = await service.send({
      churchId: 'church-1',
      category: 'church_welcome',
      to: 'ada@example.test',
      subject: 'Welcome',
      html: '<p>Hi</p>',
    });

    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'queued' }) }),
    );
    expect(emailQueue.add).toHaveBeenCalledWith('send', { emailLogId: 'log-1' });
    expect(log.id).toBe('log-1');
  });

  it('marks the row failed, without throwing, when the enqueue itself fails', async () => {
    const { service, prisma } = build({ addThrows: true });

    await expect(
      service.send({
        churchId: 'church-1',
        category: 'church_welcome',
        to: 'ada@example.test',
        subject: 'Welcome',
        html: '<p>Hi</p>',
      }),
    ).resolves.toBeDefined();

    expect(prisma.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('never throws to the caller even when recording the enqueue failure itself fails', async () => {
    const { service } = build({ addThrows: true, updateThrows: true });

    await expect(
      service.send({
        churchId: 'church-1',
        category: 'church_welcome',
        to: 'ada@example.test',
        subject: 'Welcome',
        html: '<p>Hi</p>',
      }),
    ).resolves.toBeDefined();
  });
});
