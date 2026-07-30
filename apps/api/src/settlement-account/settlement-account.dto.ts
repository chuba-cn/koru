import {
  CreateSettlementAccountSchema,
  ListSettlementAccountsQuerySchema,
  paginatedResponseSchema,
  SettlementAccountSchema,
  UpdateSettlementAccountSchema,
} from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateSettlementAccountDto extends createZodDto(CreateSettlementAccountSchema) {}
export class UpdateSettlementAccountDto extends createZodDto(UpdateSettlementAccountSchema) {}
export class ListSettlementAccountsQueryDto extends createZodDto(
  ListSettlementAccountsQuerySchema,
) {}
export class SettlementAccountDto extends createZodDto(SettlementAccountSchema) {}
export class SettlementAccountPageDto extends createZodDto(
  paginatedResponseSchema(SettlementAccountSchema),
) {}
