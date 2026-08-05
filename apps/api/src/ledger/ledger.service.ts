import type { DomainEventPayload } from '@koru/shared';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { OutboxService } from '../events/outbox.service';
import type { LedgerAccount, LedgerEntryType, Prisma } from '../generated/prisma/client';
import { Prisma as PrismaNamespace } from '../generated/prisma/client';
import { assertTransactionClient } from '../prisma/assert-transaction-client';

type LedgerEntryInput = {
  account: LedgerAccount;
  entryType: LedgerEntryType;
  amountKobo: bigint;
  branchId?: string;
  campaignId?: string;
  dedupeKey: string;
};

type PostInput = {
  churchId: string;
  reason: string;
  entries: LedgerEntryInput[];
  eventPayload: DomainEventPayload;
};

/**
 * The only writer of LedgerTransaction/LedgerEntry rows. See
 * docs/architecture/transactional-outbox-and-relay.md for the full
 * rationale.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly outbox: OutboxService) {}

  async post(tx: Prisma.TransactionClient, input: PostInput) {
    assertTransactionClient(tx);

    if (input.entries.length < 2) {
      throw new BadRequestException('A posting needs at least one debit and one credit entry');
    }
    if (input.entries.some((entry) => entry.amountKobo <= 0n)) {
      throw new BadRequestException('Every ledger entry amount must be a positive integer Kobo');
    }

    const balance = input.entries.reduce(
      (sum, entry) => sum + (entry.entryType === 'debit' ? entry.amountKobo : -entry.amountKobo),
      0n,
    );

    if (balance !== 0n) {
      throw new BadRequestException(
        `Ledger posting for church ${input.churchId} does not balance: debit minus credit = ${balance} kobo`,
      );
    }

    await this.assertEntriesBelongToChurch(tx, input.churchId, input.entries);

    const transaction = await tx.ledgerTransaction.create({
      data: { churchId: input.churchId, reason: input.reason },
    });

    try {
      await tx.ledgerEntry.createMany({
        data: input.entries.map((entry) => ({
          transactionId: transaction.id,
          churchId: input.churchId,
          branchId: entry.branchId,
          campaignId: entry.campaignId,
          account: entry.account,
          entryType: entry.entryType,
          amountKobo: entry.amountKobo,
          dedupeKey: entry.dedupeKey,
        })),
      });
    } catch (error: unknown) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A ledger entry for this posting was already recorded (duplicate dedupeKey)',
        );
      }

      throw error;
    }

    const event = await this.outbox.record(tx, {
      churchId: input.churchId,
      payload: input.eventPayload,
    });

    return { transaction, event };
  }

  /** The database does not enforce denormalized churchId (ADR-0018) — this does. */
  private async assertEntriesBelongToChurch(
    tx: Prisma.TransactionClient,
    churchId: string,
    entries: LedgerEntryInput[],
  ) {
    const campaignIds = [...new Set(entries.map((e) => e.campaignId).filter(Boolean))] as string[];
    const branchIds = [...new Set(entries.map((e) => e.branchId).filter(Boolean))] as string[];

    const [campaigns, branches] = await Promise.all([
      campaignIds.length
        ? tx.campaign.findMany({
            where: { id: { in: campaignIds }, churchId },
            select: { id: true },
          })
        : Promise.resolve([]),
      branchIds.length
        ? tx.branch.findMany({ where: { id: { in: branchIds }, churchId }, select: { id: true } })
        : Promise.resolve([]),
    ]);

    if (campaigns.length !== campaignIds.length) {
      throw new BadRequestException('One or more campaignIds do not belong to this church');
    }
    if (branches.length !== branchIds.length) {
      throw new BadRequestException('One or more branchIds do not belong to this church');
    }
  }
}
