import { z } from 'zod';

/**
 * Nigerian phone number in E.164 form (+234...) or local form (0...).
 */
export const PhoneSchema = z
  .string()
  .regex(/^(\+234[789][01]\d{8}|0[789][01]\d{8})$/, 'must be a valid Nigerian phone number');
