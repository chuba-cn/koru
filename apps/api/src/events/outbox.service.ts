import type { DomainEventPayload } from '@koru/shared';
import { DomainEventPayloadSchema } from '@koru/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { assertTransactionClient } from '../prisma/assert-transaction-client';

type RecordInput = {
  churchId: string;
  payload: DomainEventPayload;
};

/** Writes a DomainEvent row, always in the same tx as the fact it describes. */
@Injectable()
export class OutboxService {
  async record(tx: Prisma.TransactionClient, input: RecordInput) {
    assertTransactionClient(tx);

    let payload: DomainEventPayload;
    try {
      payload = DomainEventPayloadSchema.parse(input.payload);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException(`Invalid DomainEvent payload: ${error.message}`);
      }
      throw error;
    }

    if (payload.churchId !== input.churchId) {
      throw new BadRequestException("The event payload's churchId must match the posting church");
    }

    return tx.domainEvent.create({
      data: {
        churchId: input.churchId,
        type: payload.type,
        payload,
      },
    });
  }
}
