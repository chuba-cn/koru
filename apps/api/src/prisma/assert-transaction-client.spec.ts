import { describe, expect, it } from 'vitest';
import { assertTransactionClient } from './assert-transaction-client';

describe('assertTransactionClient', () => {
  it('accepts an object with no $connect, the shape a real tx client has', () => {
    const tx = { domainEvent: { create: () => {} } };

    expect(() => assertTransactionClient(tx as never)).not.toThrow();
  });

  it('rejects an object carrying $connect, the shape the full PrismaClient has', () => {
    const wholeClient = { $connect: async () => {}, domainEvent: { create: () => {} } };

    expect(() => assertTransactionClient(wholeClient as never)).toThrow(
      /must run inside a transaction/,
    );
  });
});
