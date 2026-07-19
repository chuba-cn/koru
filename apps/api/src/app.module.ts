import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth';
import { BranchModule } from './branch/branch.module';
import { ChurchModule } from './church/church.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { HealthModule } from './health/health.module';
import { MemberModule } from './member/member.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { RegionModule } from './region/region.module';
import { SettlementAccountModule } from './settlement-account/settlement-account.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    HealthModule,
    PrismaModule,
    ChurchModule,
    RegionModule,
    BranchModule,
    StaffModule,
    MemberModule,
    SettlementAccountModule,
    OnboardingModule,
    AuthModule.forRoot({ auth }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
