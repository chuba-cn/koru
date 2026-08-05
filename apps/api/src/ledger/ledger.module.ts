import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { LedgerService } from './ledger.service';

@Module({
  imports: [EventsModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
