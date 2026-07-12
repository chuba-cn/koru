import { CreateRegionSchema, RegionSchema, UpdateRegionSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateRegionDto extends createZodDto(CreateRegionSchema) {}
export class UpdateRegionDto extends createZodDto(UpdateRegionSchema) {}
export class RegionDto extends createZodDto(RegionSchema) {}
