import {
  CampaignSchema,
  CreateCampaignSchema,
  ListCampaignsQuerySchema,
  paginatedResponseSchema,
  UpdateCampaignSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateCampaignDto extends createZodDto(CreateCampaignSchema) {}
export class UpdateCampaignDto extends createZodDto(UpdateCampaignSchema) {}
export class ListCampaignsQueryDto extends createZodDto(ListCampaignsQuerySchema) {}
export class CampaignDto extends createZodDto(CampaignSchema) {}
export class CampaignPageDto extends createZodDto(paginatedResponseSchema(CampaignSchema)) {}
