import {
  BranchDirectoryItemSchema,
  JoinMemberSchema,
  MemberSchema,
  MyProfileSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class JoinMemberDto extends createZodDto(JoinMemberSchema) {}
export class MemberDto extends createZodDto(MemberSchema) {}
export class BranchDirectoryItemDto extends createZodDto(BranchDirectoryItemSchema) {}
export class MyProfileDto extends createZodDto(MyProfileSchema) {}
