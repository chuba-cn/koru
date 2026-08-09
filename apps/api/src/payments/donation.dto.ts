import { CreateDonationSchema, DonationSchema } from '@koru/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateDonationDto extends createZodDto(CreateDonationSchema) {}
export class DonationDto extends createZodDto(DonationSchema) {}
