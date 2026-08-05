import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

/**
 * Consumes the domain-events queue.
 */
@Processor('domain-events')
export class DomainEventProcessor extends WorkerHost {
  private readonly logger = new Logger(DomainEventProcessor.name);

  async process(job: Job<{ domainEventId: string }>) {
    this.logger.debug(`No handler registered yet for domain event ${job.data.domainEventId}`);
  }
}
