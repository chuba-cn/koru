import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaystackAdapter } from './paystack.adapter';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PaystackAdapter', () => {
  let adapter: PaystackAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new PaystackAdapter();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createTransferCharge', () => {
    it('sends the exact bank_transfer body Paystack expects, including account_expires_at', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: {
            reference: 'attempt-1',
            status: 'pending_bank_transfer',
            account_name: 'PAYSTACK CHECKOUT',
            account_number: '1231986612',
            bank: { slug: 'test-bank', name: 'Test Bank', id: 24 },
            account_expires_at: '2026-08-05T17:00:00.000Z',
            amount: 15000,
          },
        }),
      );

      const requestedExpiresAt = new Date('2026-08-05T16:30:00.000Z');
      await adapter.createTransferCharge({
        reference: 'attempt-1',
        amountKobo: 15000,
        email: 'member.abc@giving.koru.ng',
        subaccountCode: 'ACCT_xyz',
        requestedExpiresAt,
        metadata: { churchId: 'church-1' },
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.paystack.co/charge');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        amount: '15000',
        email: 'member.abc@giving.koru.ng',
        reference: 'attempt-1',
        currency: 'NGN',
        subaccount: 'ACCT_xyz',
        bearer: 'subaccount',
        metadata: { churchId: 'church-1' },
        bank_transfer: { account_expires_at: '2026-08-05T16:30:00.000Z' },
      });
    });

    it("returns the provider's account_expires_at, not the requested one", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: {
            reference: 'attempt-1',
            status: 'pending_bank_transfer',
            account_name: 'PAYSTACK CHECKOUT',
            account_number: '1231986612',
            bank: { slug: 'test-bank', name: 'Test Bank', id: 24 },
            account_expires_at: '2026-08-05T17:00:00.000Z',
            amount: 15000,
          },
        }),
      );

      const result = await adapter.createTransferCharge({
        reference: 'attempt-1',
        amountKobo: 15000,
        email: 'a@giving.koru.ng',
        subaccountCode: 'ACCT_xyz',
        requestedExpiresAt: new Date('2026-08-05T16:30:00.000Z'),
        metadata: {},
      });

      expect(result.accountExpiresAt).toBe('2026-08-05T17:00:00.000Z');
    });

    it('throws when the response carries no account_expires_at', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: {
            reference: 'attempt-1',
            status: 'pending_bank_transfer',
            account_number: '1231986612',
            bank: { name: 'Test Bank' },
            amount: 15000,
          },
        }),
      );

      await expect(
        adapter.createTransferCharge({
          reference: 'attempt-1',
          amountKobo: 15000,
          email: 'a@giving.koru.ng',
          subaccountCode: 'ACCT_xyz',
          requestedExpiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('keeps a uint64 providerChargeId as a string, never rounding it as a number', async () => {
      // Constructed from raw JSON text, not a JS numeric literal — the id is
      // large enough that a JS source literal would already lose precision
      // at parse time (biome's own noPrecisionLoss check catches that). The
      // adapter's guarantee is only that it applies String() unconditionally,
      // never that JSON parsing itself is lossless for a number this size.
      const rawJson =
        '{"status":true,"data":{"id":99999999999999999999,"reference":"attempt-1","status":"pending_bank_transfer","account_number":"1231986612","bank":{"name":"Test Bank"},"account_expires_at":"2026-08-05T17:00:00.000Z","amount":15000}}';
      fetchMock.mockResolvedValueOnce(
        new Response(rawJson, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      const result = await adapter.createTransferCharge({
        reference: 'attempt-1',
        amountKobo: 15000,
        email: 'a@giving.koru.ng',
        subaccountCode: 'ACCT_xyz',
        requestedExpiresAt: new Date(),
        metadata: {},
      });

      expect(typeof result.providerChargeId).toBe('string');
    });

    it('maps a non-2xx response to ServiceUnavailableException, never leaking the raw body', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { status: false, message: 'Invalid amount' }),
      );

      await expect(
        adapter.createTransferCharge({
          reference: 'attempt-1',
          amountKobo: 50,
          email: 'a@giving.koru.ng',
          subaccountCode: 'ACCT_xyz',
          requestedExpiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('maps a network failure to ServiceUnavailableException', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        adapter.createTransferCharge({
          reference: 'attempt-1',
          amountKobo: 15000,
          email: 'a@giving.koru.ng',
          subaccountCode: 'ACCT_xyz',
          requestedExpiresAt: new Date(),
          metadata: {},
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('verifySignature', () => {
    it('accepts a correct HMAC SHA512 signature of the raw bytes', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const sig = createHmac('sha512', 'unit-test-value-never-calls-paystack')
        .update(rawBody)
        .digest('hex');

      expect(adapter.verifySignature(rawBody, { 'x-paystack-signature': sig })).toBe(true);
    });

    it('rejects a body that was re-serialized instead of the original raw bytes', () => {
      const original = Buffer.from(JSON.stringify({ event: 'charge.success', a: 1, b: 2 }));
      const sig = createHmac('sha512', 'unit-test-value-never-calls-paystack')
        .update(original)
        .digest('hex');
      const reSerialized = Buffer.from(JSON.stringify({ b: 2, a: 1, event: 'charge.success' }));

      expect(adapter.verifySignature(reSerialized, { 'x-paystack-signature': sig })).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(adapter.verifySignature(Buffer.from('{}'), {})).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('derives charge:<id> for a bank_transfer charge.success', () => {
      const body = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: { id: 12345, reference: 'attempt-1', channel: 'bank_transfer' },
        }),
      );

      const signal = adapter.parseWebhook(body);
      expect(signal).toMatchObject({
        kind: 'charge_succeeded',
        providerEventKey: 'charge:12345',
        reference: 'attempt-1',
      });
    });

    it('treats a charge.success on a non-bank_transfer channel as ignored', () => {
      const body = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: { id: 12345, reference: 'attempt-1', channel: 'card' },
        }),
      );

      expect(adapter.parseWebhook(body).kind).toBe('ignored');
    });

    it('derives transfer_rejected:<ref>:<status> for bank.transfer.rejected', () => {
      const body = Buffer.from(
        JSON.stringify({
          event: 'bank.transfer.rejected',
          data: { reference: 'attempt-1', status: 'rejected', reason: 'wrong amount' },
        }),
      );

      const signal = adapter.parseWebhook(body);
      expect(signal).toMatchObject({
        kind: 'transfer_rejected',
        providerEventKey: 'transfer_rejected:attempt-1:rejected',
        reference: 'attempt-1',
        reason: 'wrong amount',
      });
    });

    it('throws when bank.transfer.rejected carries no reference at all', () => {
      const body = Buffer.from(JSON.stringify({ event: 'bank.transfer.rejected', data: {} }));

      expect(() => adapter.parseWebhook(body)).toThrow(BadRequestException);
    });

    it('keys an unrecognized event by a content hash, not a fixed string', () => {
      const bodyA = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { id: 1 } }));
      const bodyB = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { id: 2 } }));

      const a = adapter.parseWebhook(bodyA);
      const b = adapter.parseWebhook(bodyB);
      expect(a.kind).toBe('ignored');
      expect(a.providerEventKey).not.toBe(b.providerEventKey);
    });
  });

  describe('fetchCharge', () => {
    it('uses amountAccepted-equivalent mapping and accepts fees as either a string or a number', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: {
            id: 1,
            reference: 'attempt-1',
            status: 'success',
            amount: 15000,
            fees: '375',
            currency: 'NGN',
            channel: 'bank_transfer',
            paid_at: '2026-08-05T17:00:00.000Z',
            subaccount: { subaccount_code: 'ACCT_xyz' },
            metadata: null,
          },
        }),
      );

      const facts = await adapter.fetchCharge('attempt-1');
      expect(facts.feesKobo).toBe(375);
      expect(facts.subaccountCode).toBe('ACCT_xyz');
    });

    it('accepts a numeric fees field the same way', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: {
            id: 1,
            reference: 'attempt-1',
            status: 'success',
            amount: 15000,
            fees: 375,
            currency: 'NGN',
            channel: 'bank_transfer',
            paid_at: null,
            subaccount: null,
            metadata: null,
          },
        }),
      );

      const facts = await adapter.fetchCharge('attempt-1');
      expect(facts.feesKobo).toBe(375);
      expect(facts.paidAt).toBeNull();
    });

    it('throws NotFoundException on a 404, distinct from a 5xx', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { status: false, message: 'not found' }));

      await expect(adapter.fetchCharge('missing-ref')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listBanks', () => {
    function bankRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        name: 'GTBank',
        slug: 'gtbank',
        code: '058',
        currency: 'NGN',
        active: true,
        is_deleted: false,
        ...overrides,
      };
    }

    it('filters out inactive and deleted banks', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: [
            bankRow(),
            bankRow({ code: '999', active: false }),
            bankRow({ code: '998', is_deleted: true }),
          ],
        }),
      );

      const banks = await adapter.listBanks();
      expect(banks).toHaveLength(1);
      expect(banks[0]?.code).toBe('058');
    });

    it('requests Paystack’s real bank directory path, not the plural /banks', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: true, data: [bankRow()] }));

      await adapter.listBanks();

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('/bank?');
      expect(url).not.toContain('/banks');
    });

    it('issues exactly one upstream request for two concurrent calls, and zero for a third inside the TTL', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: true, data: [bankRow()] }));

      await Promise.all([adapter.listBanks(), adapter.listBanks()]);
      await adapter.listBanks();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows meta.next across multiple pages and stops once it is absent', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, {
            status: true,
            data: [bankRow({ code: '001' })],
            meta: { next: 'cursor-a', previous: null },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            status: true,
            data: [bankRow({ code: '002' })],
            meta: { next: 'cursor-b', previous: 'x' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, { status: true, data: [bankRow({ code: '003' })] }),
        );

      const banks = await adapter.listBanks();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(banks.map((b) => b.code)).toEqual(['001', '002', '003']);
      const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
      const thirdUrl = fetchMock.mock.calls[2]?.[0] as string;
      expect(secondUrl).toContain('next=cursor-a');
      expect(thirdUrl).toContain('next=cursor-b');
    });
  });

  describe('resolveAccountNumber', () => {
    it('maps a Paystack status:false to BadRequestException, not ServiceUnavailableException', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { status: false, message: 'Could not resolve' }),
      );

      await expect(
        adapter.resolveAccountNumber({ accountNumber: '0000000000', bankCode: '001' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a network failure to ServiceUnavailableException, distinct from a 4xx', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        adapter.resolveAccountNumber({ accountNumber: '0000000000', bankCode: '001' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('never logs the plaintext account number, on either the 4xx or the network-failure path', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      fetchMock.mockResolvedValueOnce(jsonResponse(400, { status: false, message: 'bad' }));
      await adapter
        .resolveAccountNumber({ accountNumber: '5551234567', bankCode: '001' })
        .catch(() => undefined);

      fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await adapter
        .resolveAccountNumber({ accountNumber: '5551234567', bankCode: '001' })
        .catch(() => undefined);

      const loggedText = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toContain('5551234567');

      errorSpy.mockRestore();
    });

    it('resolves a real response to accountNumber/accountName', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          status: true,
          data: { account_number: '0000000000', account_name: 'TEST ACCOUNT 0000000000' },
        }),
      );

      const resolved = await adapter.resolveAccountNumber({
        accountNumber: '0000000000',
        bankCode: '001',
      });
      expect(resolved.accountName).toBe('TEST ACCOUNT 0000000000');
    });
  });

  describe('createSubaccount', () => {
    it('sends percentage_charge and a stringified metadata object', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          status: true,
          data: {
            subaccount_code: 'ACCT_xyz',
            account_number: '0000000000',
            settlement_bank: '057',
            is_verified: false,
          },
        }),
      );

      await adapter.createSubaccount({
        businessName: 'Test Church',
        bankCode: '057',
        accountNumber: '0000000000',
        percentageCharge: 0,
        metadata: { churchId: 'church-1' },
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.percentage_charge).toBe(0);
      expect(typeof body.metadata).toBe('string');
      expect(JSON.parse(body.metadata)).toEqual({ churchId: 'church-1' });
    });

    it('returns a masked account number even though Paystack echoes the plaintext', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          status: true,
          data: {
            subaccount_code: 'ACCT_xyz',
            account_number: '0000000000',
            settlement_bank: '057',
            is_verified: false,
          },
        }),
      );

      const facts = await adapter.createSubaccount({
        businessName: 'Test Church',
        bankCode: '057',
        accountNumber: '0000000000',
        percentageCharge: 0,
        metadata: {},
      });

      expect(facts.accountNumberMasked).toContain('*');
      expect(facts.accountNumberMasked).not.toBe('0000000000');
    });

    it('rejects with ServiceUnavailableException on failure, never a bare error', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { status: false, message: 'Account details are invalid' }),
      );

      await expect(
        adapter.createSubaccount({
          businessName: 'Test Church',
          bankCode: '057',
          accountNumber: 'bad',
          percentageCharge: 0,
          metadata: {},
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
