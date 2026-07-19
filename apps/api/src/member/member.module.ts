import { Module } from '@nestjs/common';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { JoinController } from './join.controller';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';

@Module({
  controllers: [MemberController, JoinController],
  providers: [MemberService, VerifiedPhoneGuard],
})
export class MemberModule {}
