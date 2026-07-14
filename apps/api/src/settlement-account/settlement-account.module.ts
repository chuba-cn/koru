import { Module } from '@nestjs/common';
import { SettlementAccountController } from './settlement-account.controller';
import { SettlementAccountService } from './settlement-account.service';

@Module({
  controllers: [SettlementAccountController],
  providers: [SettlementAccountService],
})
export class SettlementAccountModule {}
