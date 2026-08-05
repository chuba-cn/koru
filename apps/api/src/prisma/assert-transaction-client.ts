import type { Prisma } from '../generated/prisma/client';

/**
 * PrismaService is structurally assignable to Prisma.TransactionClient, so
 * the type alone cannot stop a caller from passing the whole client where a
 * transaction is required. $connect is the runtime discriminator — a real
 * transaction client genuinely lacks it, confirmed against this exact
 * Prisma 7 + adapter-pg setup.
 */
export function assertTransactionClient(tx: Prisma.TransactionClient) {
  if ('$connect' in tx) {
    throw new Error(
      'Expected a Prisma.TransactionClient (the tx passed inside prisma.$transaction), ' +
        'got the full PrismaClient/PrismaService instead — this call must run inside a transaction.',
    );
  }
}
