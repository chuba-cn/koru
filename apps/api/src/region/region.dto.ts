import {
  CreateRegionSchema,
  paginatedResponseSchema,
  RegionSchema,
  UpdateRegionSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateRegionDto extends createZodDto(CreateRegionSchema) {}
export class UpdateRegionDto extends createZodDto(UpdateRegionSchema) {}
export class RegionDto extends createZodDto(RegionSchema) {}
export class RegionPageDto extends createZodDto(paginatedResponseSchema(RegionSchema)) {}
