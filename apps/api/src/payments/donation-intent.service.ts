import { randomUUID } from 'node:crypto';
import { koboToBigint } from '@koru/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OutboxService } from '../events/outbox.service';
import type {
  DonationIntent,
  DonationIntentStatus,
  PaymentAttempt,
} from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import {
  PAYSTACK_ACCOUNT_TTL_MINUTES,
  PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN,
} from './gateway/paystack.config';

type CreateIntentInput = {
  churchId: string;
  campaignId: string;
  memberId: string;
  pledgeId?: string;
  amountKobo: number;
  idempotencyKey: string;
};

type CreateIntentResult = {
  intent: DonationIntent;
  attempt: PaymentAttempt | null;
  replayed: boolean;
};

const MAX_PENDING_ATTEMPTS_PER_MEMBER = 5;

/** Replaying one of these can never produce a usable transfer instruction. */
const DEAD_INTENT_STATUSES: DonationIntentStatus[] = ['failed', 'expired', 'cancelled'];

/** See docs/architecture/paystack-pay-with-transfer.md. */
@Injectable()
export class DonationIntentService {
  private readonly logger = new Logger(DonationIntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  private async resolveMemberId(userId: string, churchId: string) {
    const member = await this.prisma.member.findFirst({
      where: { userId, churchId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('You are not a member of this church');

    return member.id;
  }

  async createForUser(
    userId: string,
    churchId: string,
    input: Omit<CreateIntentInput, 'churchId' | 'memberId'>,
  ): Promise<CreateIntentResult> {
    const memberId = await this.resolveMemberId(userId, churchId);

    return this.createIntentWithTransferAttempt({ ...input, churchId, memberId });
  }

  async findForUser(userId: string, churchId: string, donationId: string) {
    const memberId = await this.resolveMemberId(userId, churchId);

    const intent = await this.prisma.donationIntent.findFirst({
      where: { id: donationId, churchId, memberId },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!intent) throw new NotFoundException(`Donation ${donationId} not found`);

    return { intent, attempt: intent.attempts[0] ?? null };
  }

  async createIntentWithTransferAttempt(input: CreateIntentInput): Promise<CreateIntentResult> {
    const existing = await this.findExistingReplay(input);
    if (existing) return existing;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, churchId: input.churchId },
      include: { settlementAccount: true },
    });
    if (!campaign) throw new NotFoundException(`Campaign ${input.campaignId} not found`);
    if (campaign.status !== 'active') {
      throw new BadRequestException('Campaign is not accepting giving');
    }
    if (campaign.currency !== 'NGN') {
      throw new BadRequestException('Online giving currently only supports NGN campaigns');
    }
    if (!campaign.settlementAccount.providerSubaccountCode) {
      throw new BadRequestException(
        "This campaign's settlement account is not set up to receive online gifts yet",
      );
    }

    const member = await this.prisma.member.findFirst({
      where: { id: input.memberId, churchId: input.churchId },
      select: { id: true, email: true, homeBranchId: true },
    });
    if (!member) throw new NotFoundException(`Member ${input.memberId} not found`);

    const pendingCount = await this.prisma.paymentAttempt.count({
      where: {
        churchId: input.churchId,
        donationIntent: { memberId: member.id },
        status: { in: ['pending', 'processing'] },
      },
    });
    if (pendingCount >= MAX_PENDING_ATTEMPTS_PER_MEMBER) {
      throw new ConflictException(
        'Too many donations in progress - finish or let one expire before starting another',
      );
    }

    if (input.pledgeId) {
      const pledge = await this.prisma.pledge.findFirst({
        where: { id: input.pledgeId, campaignId: input.campaignId },
      });
      if (!pledge) {
        throw new BadRequestException('pledgeId does not belong to this campaign');
      }
    }

    const attemptId = randomUUID();

    let intent: DonationIntent;
    let attempt: PaymentAttempt;

    try {
      ({ intent, attempt } = await this.prisma.$transaction(async (tx) => {
        const newIntent = await tx.donationIntent.create({
          data: {
            churchId: input.churchId,
            branchId: member.homeBranchId,
            campaignId: input.campaignId,
            memberId: input.memberId,
            pledgeId: input.pledgeId,
            amountKobo: koboToBigint(input.amountKobo),
            idempotencyKey: input.idempotencyKey,
            status: 'pending',
          },
        });

        const newAttempt = await tx.paymentAttempt.create({
          data: {
            id: attemptId,
            churchId: input.churchId,
            branchId: member.homeBranchId,
            donationIntentId: newIntent.id,
            channel: 'paystack_transfer',
            provider: 'paystack',
            status: 'pending',
            providerReference: attemptId,
            settlementAccountId: campaign.settlementAccountId,
            amountKobo: koboToBigint(input.amountKobo),
          },
        });

        await this.outbox.record(tx, {
          churchId: input.churchId,
          payload: {
            type: 'donation_intent_created',
            donationIntentId: newIntent.id,
            churchId: input.churchId,
            campaignId: input.campaignId,
            memberId: input.memberId,
            amountKobo: input.amountKobo,
          },
        });

        return { intent: newIntent, attempt: newAttempt };
      }));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findExistingReplay(input);
        if (replay) return replay;
      }

      throw error;
    }

    const email = member.email ?? `member.${member.id}@${PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN}`;
    try {
      const charge = await this.gateway.createTransferCharge({
        reference: attempt.id,
        amountKobo: input.amountKobo,
        email,
        subaccountCode: campaign.settlementAccount.providerSubaccountCode,
        requestedExpiresAt: new Date(Date.now() + PAYSTACK_ACCOUNT_TTL_MINUTES * 60_000),
        metadata: {
          churchId: input.churchId,
          campaignId: input.campaignId,
          memberId: input.memberId,
          donationIntentId: intent.id,
          paymentAttemptId: attempt.id,
        },
      });

      const [updatedAttempt, updatedIntent] = await this.prisma.$transaction([
        this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            virtualAccountNumber: charge.accountNumber,
            virtualAccountBank: charge.bankName,
            virtualAccountName: charge.accountName,
            expiresAt: new Date(charge.accountExpiresAt),
          },
        }),
        this.prisma.donationIntent.update({
          where: { id: intent.id },
          data: { status: 'processing' },
        }),
      ]);

      return { intent: updatedIntent, attempt: updatedAttempt, replayed: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown gateway error';
      this.logger.error(`Charge creation failed for attempt ${attempt.id}: ${message}`);
      await this.prisma.$transaction([
        this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: 'failed', failureReason: message.slice(0, 500) },
        }),
        this.prisma.donationIntent.update({ where: { id: intent.id }, data: { status: 'failed' } }),
      ]);
      throw error;
    }
  }

  private async findExistingReplay(input: CreateIntentInput): Promise<CreateIntentResult | null> {
    const existing = await this.prisma.donationIntent.findFirst({
      where: {
        churchId: input.churchId,
        memberId: input.memberId,
        idempotencyKey: input.idempotencyKey,
      },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!existing) return null;

    const sameRequest =
      existing.campaignId === input.campaignId &&
      (existing.pledgeId ?? null) === (input.pledgeId ?? null) &&
      existing.amountKobo === koboToBigint(input.amountKobo);
    if (!sameRequest) {
      throw new ConflictException(
        'That idempotencyKey was used for a different donation. Use a fresh one.',
      );
    }

    if (DEAD_INTENT_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `That donation already ${existing.status}. Start a new one with a fresh idempotencyKey.`,
      );
    }

    return { intent: existing, attempt: existing.attempts[0] ?? null, replayed: true };
  }
}
