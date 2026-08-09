import { randomUUID } from 'node:crypto';
import type { ChargeFacts } from '@koru/shared';
import { koboToBigint } from '@koru/shared';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async postCharge(facts: ChargeFacts) {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { providerReference: facts.reference },
      include: {
        settlementAccount: true,
        donationIntent: { include: { campaign: true } },
      },
    });
    if (!attempt) {
      this.logger.error(`No PaymentAttempt found for provider reference ${facts.reference}`);
      throw new NotFoundException(`No PaymentAttempt for reference ${facts.reference}`);
    }

    if (facts.status !== 'success') {
      this.logger.warn(
        `Charge ${facts.reference} fetched with status "${facts.status}" - not settled yet, will retry`,
      );
      throw new ConflictException(
        `Charge ${facts.reference} is not yet settled (status: ${facts.status})`,
      );
    }

    const { donationIntent: intent } = attempt;
    const { campaign } = intent;

    if (intent.churchId !== attempt.churchId || campaign.churchId !== attempt.churchId) {
      this.logger.error(
        `Denormalization mismatch settling attempt ${attempt.id}: intent/campaign churchId disagrees with the attempt's own churchId`,
      );
      throw new ConflictException('Tenant mismatch settling this charge');
    }

    if (facts.subaccountCode !== attempt.settlementAccount?.providerSubaccountCode) {
      this.logger.error(
        `Charge ${facts.reference} settled into ${facts.subaccountCode}, which does not match the settlement account attempt ${attempt.id} was created against`,
      );
      throw new ConflictException('Charge settled into a subaccount this attempt does not own');
    }

    if (facts.currency !== 'NGN') {
      throw new ConflictException(`Cannot settle a non-NGN charge ${facts.currency}`);
    }

    if (koboToBigint(facts.amountKobo) !== attempt.amountKobo) {
      this.logger.error(
        `Charge ${facts.reference} settled for ${facts.amountKobo} kobo, attempt ${attempt.id} expected ${attempt.amountKobo} kobo`,
      );
      throw new ConflictException('Settled amount does not match the attempt');
    }

    const paymentId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM "PaymentAttempt" WHERE id = ${attempt.id} FOR UPDATE`;

      const currentStatus = locked[0]?.status;
      if (currentStatus === 'succeeded') return;
      if (currentStatus === 'failed') {
        throw new ConflictException(`Attempt ${attempt.id} failed, refusing to settle it.`);
      }

      await this.ledger.post(tx, {
        churchId: attempt.churchId,
        reason: `${facts.provider} charge settled: ${facts.reference}`,
        entries: [
          {
            account: 'gateway_clearing',
            entryType: 'debit',
            amountKobo: koboToBigint(facts.amountKobo),
            branchId: attempt.branchId ?? undefined,
            provider: facts.provider,
            dedupeKey: `${facts.provider}:charge:${facts.providerChargeId}:gateway_clearing`,
          },
          {
            account: 'campaign_giving',
            entryType: 'credit',
            amountKobo: koboToBigint(facts.amountKobo),
            branchId: attempt.branchId ?? undefined,
            campaignId: intent.campaignId,
            provider: facts.provider,
            dedupeKey: `${facts.provider}:charge:${facts.providerChargeId}:campaign_giving`,
          },
        ],
        eventPayload: {
          type: 'payment_settled',
          paymentId,
          churchId: attempt.churchId,
          campaignId: intent.campaignId,
          memberId: intent.memberId,
          amountKobo: facts.amountKobo,
        },
      });

      await tx.payment.create({
        data: {
          id: paymentId,
          churchId: attempt.churchId,
          branchId: attempt.branchId,
          campaignId: intent.campaignId,
          memberId: intent.memberId,
          pledgeId: intent.pledgeId,
          paymentAttemptId: attempt.id,
          amountKobo: koboToBigint(facts.amountKobo),
          channel: 'paystack_transfer',
          provider: facts.provider,
          state: 'settled',
          providerReference: facts.reference,
          virtualAccountNumber: attempt.virtualAccountNumber,
          virtualAccountBank: attempt.virtualAccountBank,
          paidAt: facts.paidAt ? new Date(facts.paidAt) : new Date(),
        },
      });

      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'succeeded' } });
      await tx.donationIntent.update({ where: { id: intent.id }, data: { status: 'succeeded' } });
    });

    return { churchId: attempt.churchId };
  }

  async recordTransferRejection(reference: string, reason: string | null) {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { providerReference: reference },
      include: { donationIntent: true },
    });
    if (!attempt) {
      this.logger.error(`No PaymentAttempt found for rejected transfer reference ${reference}`);
      throw new NotFoundException(`No PaymentAttempt for reference ${reference}`);
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT id, status FROM "PaymentAttempt" WHERE id = ${attempt.id} FOR UPDATE
        `;
      if (locked[0]?.status === 'succeeded') {
        this.logger.error(
          `bank.transfer.rejected arrived for already-settled attempt ${attempt.id} - this is a reversal, not a rejection.`,
        );
        return;
      }

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'failed',
          failureReason: reason ?? 'Bank transfer rejected by the payment gateway',
        },
      });

      const otherLiveAttempt = await tx.paymentAttempt.findFirst({
        where: {
          donationIntentId: attempt.donationIntentId,
          id: { not: attempt.id },
          status: { in: ['pending', 'processing', 'succeeded'] },
        },
        select: { id: true },
      });
      if (!otherLiveAttempt) {
        await tx.donationIntent.update({
          where: { id: attempt.donationIntentId },
          data: { status: 'failed' },
        });
      }
    });

    return { churchId: attempt.churchId };
  }
}
