import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { SettlementAccountController } from './settlement-account.controller';
import { SettlementAccountService } from './settlement-account.service';

@Module({
  controllers: [SettlementAccountController],
  providers: [SettlementAccountService, TenantGuard, RolesGuard, ScopeService],
})
export class SettlementAccountModule {}
