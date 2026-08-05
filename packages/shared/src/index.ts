export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => {
  return Math.round(naira * 100);
};

export const koboToNaira = (kobo: Kobo): number => {
  return kobo / 100;
};

const MAX_SAFE_KOBO = BigInt(Number.MAX_SAFE_INTEGER);

export const bigintToKobo = (value: bigint): Kobo => {
  if (value > MAX_SAFE_KOBO || value < -MAX_SAFE_KOBO) {
    throw new RangeError(`Kobo amount ${value} is outside the safe integer range`);
  }

  return Number(value);
};

export const koboToBigint = (kobo: Kobo): bigint => {
  if (!Number.isSafeInteger(kobo)) {
    throw new RangeError(`Kobo amount ${kobo} is not a safe integer`);
  }
  return BigInt(kobo);
};

export * from './api.js';
export * from './branch.js';
export * from './church.js';
export * from './domain-events.js';
export * from './email-log.js';
export * from './giving.js';
export * from './mask.js';
export * from './member.js';
export * from './onboarding.js';
export * from './pagination.js';
export * from './region.js';
export * from './resend-webhook.js';
export * from './schemas.js';
export * from './settlement-account.js';
export * from './staff.js';
