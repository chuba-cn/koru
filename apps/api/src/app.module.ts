import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BranchModule } from './branch/branch.module';
import { ChurchModule } from './church/church.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RegionModule } from './region/region.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [HealthModule, PrismaModule, ChurchModule, RegionModule, BranchModule, StaffModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
