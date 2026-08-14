import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth';
import { AuthPrismaLifecycle } from './auth/auth-prisma-lifecycle.service';
import { BranchModule } from './branch/branch.module';
import { CampaignModule } from './campaign/campaign.module';
import { ChurchModule } from './church/church.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { MemberModule } from './member/member.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RegionModule } from './region/region.module';
import { SettlementAccountModule } from './settlement-account/settlement-account.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    CampaignModule,
    HealthModule,
    PrismaModule,
    QueueModule,
    EventsModule,
    LedgerModule,
    NotificationsModule,
    ChurchModule,
    RegionModule,
    BranchModule,
    StaffModule,
    MemberModule,
    SettlementAccountModule,
    OnboardingModule,
    PaymentsModule,
    AuthModule.forRoot({ auth, bodyParser: { rawBody: true } }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    AuthPrismaLifecycle,
  ],
})
export class AppModule {}
