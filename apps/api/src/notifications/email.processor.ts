import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { mailSender } from './mail-sender';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ emailLogId: string }>) {
    const log = await this.prisma.emailLog.findUniqueOrThrow({
      where: { id: job.data.emailLogId },
    });

    let providerMessageId: string | undefined;

    try {
      providerMessageId = await mailSender.send(
        log.recipientEmail,
        log.subject,
        log.renderedHtml,
        log.id,
      );
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

    // The send itself already succeeded by this point — a failure recording
    // that must never be mistaken for (or retried as) a send failure, which
    // would misreport a genuinely delivered email as failed, or attempt a
    // second real send that only stays safe because of the idempotency key
    // above, masking a database problem as a mail problem.
    try {
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'sent', sentAt: new Date(), providerMessageId },
      });
    } catch (updateErr) {
      this.logger.error(
        `Email ${log.id} was sent (provider message id ${providerMessageId}) but recording that failed: ${updateErr}`,
      );
    }
  }
}
