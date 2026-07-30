import {
  BranchSchema,
  CreateBranchSchema,
  ListBranchesQuerySchema,
  paginatedResponseSchema,
  UpdateBranchSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
export class ListBranchesQueryDto extends createZodDto(ListBranchesQuerySchema) {}
export class BranchDto extends createZodDto(BranchSchema) {}
export class BranchPageDto extends createZodDto(paginatedResponseSchema(BranchSchema)) {}
