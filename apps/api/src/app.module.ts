import { Module } from '@nestjs/common';
import { ChurchModule } from './church/church.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RegionModule } from './region/region.module';

@Module({
  imports: [HealthModule, PrismaModule, ChurchModule, RegionModule],
})
export class AppModule {}
