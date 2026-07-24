import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { mailSender } from './mail-sender';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ emailLogId: string }>) {
    const log = await this.prisma.emailLog.findUniqueOrThrow({
      where: { id: job.data.emailLogId },
    });

    try {
      const providerMessageId = await mailSender.send(
        log.recipientEmail,
        log.subject,
        log.renderedHtml,
        log.id,
      );
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'sent', sentAt: new Date(), providerMessageId },
      });
    } catch (err) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.prisma.emailLog.update({
          where: { id: log.id },
          data: { status: 'failed', failureReason: String(err) },
        });
      }
      throw err;
    }
  }
}
