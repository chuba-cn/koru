import {
  BranchSchema,
  CreateBranchSchema,
  ListBranchesQuerySchema,
  UpdateBranchSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
export class ListBranchesQueryDto extends createZodDto(ListBranchesQuerySchema) {}
export class BranchDto extends createZodDto(BranchSchema) {}
