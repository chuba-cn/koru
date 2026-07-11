import { Module } from '@nestjs/common';
import { ChurchController } from './church.controller';
import { ChurchService } from './church.service';

@Module({
  controllers: [ChurchController],
  providers: [ChurchService],
})
export class ChurchModule {}
