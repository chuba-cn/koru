import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { EmailCategory } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type SendInput = {
  churchId: string;
  category: EmailCategory;
  to: string;
  subject: string;
  html: string;
  recipientStaffId?: string;
  recipientMemberId?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async send(input: SendInput) {
    const log = await this.prisma.emailLog.create({
      data: {
        churchId: input.churchId,
        category: input.category,
        recipientEmail: input.to,
        recipientStaffId: input.recipientStaffId,
        recipientMemberId: input.recipientMemberId,
        subject: input.subject,
        renderedHtml: input.html,
        providerName: 'resend',
        status: 'queued',
      },
    });

    try {
      await this.emailQueue.add('send', { emailLogId: log.id });
    } catch (error) {
      this.logger.error(`Failed to enqueue email ${log.id}: ${error}`);
      try {
        await this.prisma.emailLog.update({
          where: { id: log.id },
          data: { status: 'failed', failureReason: `Enqueue failed: ${error}` },
        });
      } catch (updateError) {
        this.logger.error(`Failed to record enqueue failure for ${log.id}: ${updateError}`);
      }
    }

    return log;
  }
}
