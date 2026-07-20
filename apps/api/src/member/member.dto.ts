import {
  BranchDirectoryItemSchema,
  JoinMemberSchema,
  MemberSchema,
  MyProfileSchema,
  PaymentHistoryItemSchema,
  PledgeHistoryItemSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class JoinMemberDto extends createZodDto(JoinMemberSchema) {}
export class MemberDto extends createZodDto(MemberSchema) {}
export class BranchDirectoryItemDto extends createZodDto(BranchDirectoryItemSchema) {}
export class MyProfileDto extends createZodDto(MyProfileSchema) {}
export class PledgeHistoryItemDto extends createZodDto(PledgeHistoryItemSchema) {}
export class PaymentHistoryItemDto extends createZodDto(PaymentHistoryItemSchema) {}
