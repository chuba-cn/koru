import { Module } from '@nestjs/common';
import { ChurchModule } from './church/church.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [HealthModule, PrismaModule, ChurchModule],
})
export class AppModule {}
