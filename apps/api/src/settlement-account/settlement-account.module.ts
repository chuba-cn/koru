import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { ScopeService } from '../auth/scope.service';
import { TenantGuard } from '../auth/tenant.guard';
import { PaymentGatewayModule } from '../payments/gateway/payment-gateway.module';
import { BankController } from './bank.controller';
import { SettlementAccountController } from './settlement-account.controller';
import { SettlementAccountService } from './settlement-account.service';

@Module({
  imports: [PaymentGatewayModule],
  controllers: [SettlementAccountController, BankController],
  providers: [SettlementAccountService, TenantGuard, RolesGuard, ScopeService],
})
export class SettlementAccountModule {}
