import {
  CreateStaffSchema,
  ReplaceScopesSchema,
  StaffSchema,
  UpdateStaffSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateStaffDto extends createZodDto(CreateStaffSchema) {}
export class UpdateStaffDto extends createZodDto(UpdateStaffSchema) {}
export class ReplaceScopesDto extends createZodDto(ReplaceScopesSchema) {}
export class StaffDto extends createZodDto(StaffSchema) {}
