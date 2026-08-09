import {
  Bank,
  ChargeFacts,
  ResolvedAccount,
  SubaccountFacts,
  TransferChargeResult,
  WebhookSignal,
} from '@koru/shared';
import type { PaymentProvider } from '../../generated/prisma/client';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** This type describes what a provider can do. A second provider
 * would set these differently instead of forcing the interface
 * down to the smallest common set.
 */
export type GatewayCapabilities = {
  /** One-shot, amount-bound virtual account per attempt. */
  transferCharge: boolean;

  /** Supplies a stable event ID on every webhook family. */
  webhookEventIds: boolean;

  /** Has a settlement/payout reporting endpoint. */
  settlementReporting: boolean;

  /** Supports partial and full refunds via API */
  refunds: boolean;

  /** Has a dispute/chargeback resource and webhook family */
  disputes: boolean;

  /** Can register a beneficiary account that receives split settlement */
  subaccounts: boolean;

  /** Publishes a bank directory and can resolve an account number to a name */
  bankDirectory: boolean;
};

export type CreateTransferChargeInput = {
  reference: string;
  amountKobo: number;
  email: string;
  subaccountCode: string;
  /** A request, not a promise - the provider clamps it and reports what it actually used. */
  requestedExpiresAt: Date;
  metadata: Record<string, string>;
};

export type CreateSubaccountInput = {
  businessName: string;
  bankCode: string;
  /** Plaintext NUBAN. In memory only - never persisted, never logged. */
  accountNumber: string;
  percentageCharge: number;
  metadata: Record<string, string>;
};

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  readonly capabilities: GatewayCapabilities;

  createTransferCharge(input: CreateTransferChargeInput): Promise<TransferChargeResult>;

  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;

  parseWebhook(rawBody: Buffer): WebhookSignal;

  /** The ONLY source a ledger posting may read amounts from. */
  fetchCharge(reference: string): Promise<ChargeFacts>;

  /** Provider bank directory. Implementations must cache; callers must not */
  listBanks(): Promise<Bank[]>;

  /** Name-enquiry. Throws BadRequestException when the provider cannot resolve */
  resolveAccountNumber(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<ResolvedAccount>;

  /** NOT idempotent at the provider. Callers must assume a retry creates a second subaccount */
  createSubaccount(input: CreateSubaccountInput): Promise<SubaccountFacts>;
}
