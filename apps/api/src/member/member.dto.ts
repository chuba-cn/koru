import {
  BranchDirectoryItemSchema,
  JoinMemberSchema,
  MemberSchema,
  MyProfileSchema,
  PaymentHistoryItemSchema,
  PledgeHistoryItemSchema,
  paginatedResponseSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class JoinMemberDto extends createZodDto(JoinMemberSchema) {}
export class MemberDto extends createZodDto(MemberSchema) {}
export class MyProfileDto extends createZodDto(MyProfileSchema) {}
export class BranchDirectoryPageDto extends createZodDto(
  paginatedResponseSchema(BranchDirectoryItemSchema),
) {}
export class PledgeHistoryPageDto extends createZodDto(
  paginatedResponseSchema(PledgeHistoryItemSchema),
) {}
export class PaymentHistoryPageDto extends createZodDto(
  paginatedResponseSchema(PaymentHistoryItemSchema),
) {}
