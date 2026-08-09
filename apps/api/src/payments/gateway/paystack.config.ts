import { requireEnv } from '../../config/env';

export const PAYSTACK_SECRET_KEY = requireEnv('PAYSTACK_SECRET_KEY');
export const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL?.trim() || 'https://api.paystack.co';
export const PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN = requireEnv('PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN');
export const PAYSTACK_ACCOUNT_TTL_MINUTES = 30;
export const PAYSTACK_HTTP_TIMEOUT_MS = 15_000;
export const PAYSTACK_SUBACCOUNT_PERCENTAGE_CHARGE = 0;
export const PAYSTACK_BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000;
