import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  type Bank,
  BankSchema,
  type ChargeFacts,
  ChargeFactsSchema,
  maskTail,
  type ResolvedAccount,
  ResolvedAccountSchema,
  type SubaccountFacts,
  SubaccountFactsSchema,
  type TransferChargeResult,
  TransferChargeResultSchema,
  type WebhookSignal,
  WebhookSignalSchema,
} from '@koru/shared';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PaymentProvider } from '../../generated/prisma/client';
import type {
  CreateSubaccountInput,
  CreateTransferChargeInput,
  GatewayCapabilities,
  PaymentGateway,
} from './payment-gateway';
import {
  PAYSTACK_BANK_LIST_TTL_MS,
  PAYSTACK_BASE_URL,
  PAYSTACK_HTTP_TIMEOUT_MS,
  PAYSTACK_SECRET_KEY,
} from './paystack.config';

/**
 * Only these two Paystack events families move money in Koru for now.
 * Every other event Paystack sends (transfer.success, dedicatedaccount.*,
 * and so on) is intentionally unhandled - see parseWebhook's default case.
 */
type PaystackWebhookBody = {
  event?: string;
  data?: Record<string, unknown>;
};

@Injectable()
export class PaystackAdapter implements PaymentGateway {
  readonly provider: PaymentProvider = 'paystack';
  readonly capabilities: GatewayCapabilities = {
    transferCharge: true,
    webhookEventIds: false,
    settlementReporting: true,
    refunds: true,
    disputes: true,
    subaccounts: true,
    bankDirectory: true,
  };

  private readonly logger = new Logger(PaystackAdapter.name);
  private bankListCache: { fetchedAt: number; banks: Bank[] } | null = null;
  private bankListInFlight: Promise<Bank[]> | null = null;

  async createTransferCharge(input: CreateTransferChargeInput): Promise<TransferChargeResult> {
    const body = await this.request('POST', '/charge', {
      amount: String(input.amountKobo),
      email: input.email,
      reference: input.reference,
      currency: 'NGN',
      subaccount: input.subaccountCode,
      bearer: 'subaccount',
      metadata: input.metadata,
      bank_transfer: { account_expires_at: input.requestedExpiresAt.toISOString() },
    });

    const d = body.data as Record<string, unknown>;
    if (d.status !== 'pending_bank_transfer') {
      throw new ServiceUnavailableException(
        `Paystack charge did not enter pending_bank_transfer (got "${String(d.status)}")`,
      );
    }

    if (!d.account_expires_at) {
      throw new ServiceUnavailableException(
        'Paystack charge response carried no account_expires_at',
      );
    }

    const bank = (d.bank ?? {}) as Record<string, unknown>;
    return TransferChargeResultSchema.parse({
      provider: this.provider,
      reference: d.reference,
      providerChargeId: d.id == null ? null : String(d.id),
      accountNumber: d.account_number,
      accountName: d.account_name ?? null,
      bankName: bank.name,
      bankSlug: bank.slug ?? null,
      accountExpiresAt: new Date(d.account_expires_at as string).toISOString(),
      amountKobo: Number(d.amount),
    });
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const sent = String(headers['x-paystack-signature'] ?? '');
    if (!sent) return false;

    const computed = createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    const sentBuf = Buffer.from(sent, 'utf-8');
    const computedBuf = Buffer.from(computed, 'utf-8');
    if (sentBuf.length !== computedBuf.length) return false;

    return timingSafeEqual(sentBuf, computedBuf);
  }

  parseWebhook(rawBody: Buffer): WebhookSignal {
    const body = JSON.parse(rawBody.toString('utf-8')) as PaystackWebhookBody;
    const data = body.data ?? {};

    if (body.event === 'charge.success') {
      if (data.id == null) {
        throw new BadRequestException('charge.success carried no transaction id');
      }
      if (data.channel !== 'bank_transfer') {
        this.logger.warn(
          `charge.success on unrecognised channel "${String(data.channel)}" - ignoring charge:${String(data.id)}. If this is a channel KORU now accepts, parseWebhook must handle it.`,
        );
        return this.ignored(body.event, `charge:${String(data.id)}`);
      }
      return WebhookSignalSchema.parse({
        kind: 'charge_succeeded',
        provider: this.provider,
        eventType: body.event,
        providerEventKey: `charge:${String(data.id)}`,
        reference: String(data.reference),
        providerChargeId: String(data.id),
      });
    }

    if (body.event === 'bank.transfer.rejected') {
      const reference = String(data.reference ?? data.transaction_reference ?? '');
      if (!reference) {
        throw new BadRequestException('bank.transfer.rejected carried no reference');
      }
      return WebhookSignalSchema.parse({
        kind: 'transfer_rejected',
        provider: this.provider,
        eventType: body.event,
        providerEventKey: `transfer_rejected:${reference}:${String(data.status ?? 'rejected')}`,
        reference,
        reason: (data.reason as string | undefined) ?? (data.message as string | undefined) ?? null,
      });
    }

    return this.ignored(
      String(body.event ?? 'unknown'),
      `${body.event}:${createHash('sha256').update(rawBody).digest('hex')}`,
    );
  }

  private ignored(eventType: string, providerEventKey: string): WebhookSignal {
    return WebhookSignalSchema.parse({
      kind: 'ignored',
      provider: 'paystack',
      eventType,
      providerEventKey,
    });
  }

  async fetchCharge(reference: string): Promise<ChargeFacts> {
    const body = await this.request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const d = body.data as Record<string, unknown>;

    return ChargeFactsSchema.parse({
      provider: this.provider,
      providerChargeId: String(d.id),
      reference: d.reference,
      status: d.status,
      amountKobo: Number(d.amount),
      feesKobo: d.fees == null ? null : Number(d.fees),
      currency: d.currency,
      channel: d.channel,
      paidAt: d.paid_at ? new Date(d.paid_at as string).toISOString() : null,
      subaccountCode: (d.subaccount as Record<string, unknown> | null)?.subaccount_code ?? null,
      metadata: (d.metadata as Record<string, unknown> | null) ?? null,
    });
  }

  async listBanks(): Promise<Bank[]> {
    const now = Date.now();

    if (this.bankListCache && now - this.bankListCache.fetchedAt < PAYSTACK_BANK_LIST_TTL_MS) {
      return this.bankListCache.banks;
    }
    if (this.bankListInFlight) return this.bankListInFlight;

    this.bankListInFlight = this.fetchBankList().finally(() => {
      this.bankListInFlight = null;
    });
    return this.bankListInFlight;
  }

  private async fetchBankList(): Promise<Bank[]> {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;

    do {
      const query = new URLSearchParams({
        country: 'nigeria',
        currency: 'NGN',
        use_cursor: 'true',
        perPage: '50',
      });
      if (cursor) query.set('next', cursor);

      const body = await this.request('GET', `/bank?${query.toString()}`);
      rows.push(...(body.data as Array<Record<string, unknown>>));
      cursor = body.meta?.next ?? undefined;
    } while (cursor);

    const banks = rows
      .filter((row) => row.active === true && row.is_deleted !== true)
      .map((row) =>
        BankSchema.parse({
          name: row.name,
          slug: row.slug,
          code: row.code,
          currency: row.currency,
          active: row.active,
        }),
      );

    this.bankListCache = { fetchedAt: Date.now(), banks };
    return banks;
  }

  async resolveAccountNumber(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<ResolvedAccount> {
    let body: { status: boolean; data?: unknown; message?: string };
    try {
      body = await this.request(
        'GET',
        `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`,
        undefined,
        { clientErrorsAreCallerFault: true },
      );
    } catch (error: unknown) {
      if (error instanceof PaystackClientError) {
        throw new BadRequestException('Could not resolve that account number at the selected bank');
      }
      throw error;
    }

    const d = body.data as Record<string, unknown>;
    return ResolvedAccountSchema.parse({
      accountNumber: d.account_number,
      accountName: d.account_name,
    });
  }

  async createSubaccount(input: CreateSubaccountInput): Promise<SubaccountFacts> {
    const body = await this.request('POST', '/subaccount', {
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      percentage_charge: input.percentageCharge,
      metadata: JSON.stringify(input.metadata),
    });
    const d = body.data as Record<string, unknown>;

    return SubaccountFactsSchema.parse({
      provider: 'paystack',
      subaccountCode: d.subaccount_code,
      accountNumberMasked: maskTail(String(d.account_number)),
      bankCode: String(d.settlement_bank),
      isVerified: (d.is_verified as boolean | undefined) ?? null,
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    jsonBody?: unknown,
    opts?: { clientErrorsAreCallerFault?: boolean },
  ): Promise<{
    status: boolean;
    data?: unknown;
    message?: string;
    meta?: { next?: string | null; previous?: string | null };
  }> {
    const redactedPath = path.split('?')[0];

    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
        signal: AbortSignal.timeout(PAYSTACK_HTTP_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      this.logger.error(`Paystack request to ${method} ${redactedPath} failed: ${String(error)}`);
      throw new ServiceUnavailableException('Paystack request failed');
    }

    if (response.status === 404) {
      this.logger.error(`Paystack returned 404 for ${method} ${redactedPath}`);
      throw new NotFoundException('The payment gateway has no such resource');
    }

    const parsed = (await response.json().catch(() => null)) as {
      status?: boolean;
      data?: unknown;
      message?: string;
      meta?: { next?: string | null; previous?: string | null };
    } | null;

    if (!response.ok || !parsed || parsed.status !== true) {
      const message = parsed?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Paystack ${method} ${redactedPath} rejected: ${message}`);
      const isClientError = response.status >= 400 && response.status < 500;

      if (opts?.clientErrorsAreCallerFault && isClientError) {
        throw new PaystackClientError(message);
      }
      throw new ServiceUnavailableException('Payment gateway request failed');
    }

    return parsed as {
      status: boolean;
      data?: unknown;
      message?: string;
      meta?: { next?: string | null; previous?: string | null };
    };
  }
}

class PaystackClientError extends Error {}
