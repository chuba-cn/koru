import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ErrorResponseDto } from '../common/api.dto';
import { MyProfileDto, PaymentHistoryItemDto, PledgeHistoryItemDto } from './member.dto';
import { MemberService } from './member.service';

@ApiTags('me')
@Controller('me')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({
    summary: 'The signed-in login: display name, phone, and every church membership',
  })
  @ApiOkResponse({ type: MyProfileDto })
  getProfile(@Session() session: UserSession<typeof auth>) {
    return this.memberService.myProfile(
      session.user.id,
      session.user.name,
      session.user.phoneNumber ?? null,
    );
  }

  @Get('churches/:churchId/pledges')
  @ApiOperation({ summary: "The signed-in member's pledges in one church" })
  @ApiOkResponse({ type: PledgeHistoryItemDto, isArray: true })
  myPledges(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
  ) {
    return this.memberService.myPledges(session.user.id, churchId);
  }

  @Get('churches/:churchId/payments')
  @ApiOperation({ summary: "The signed-in member's payments in one church" })
  @ApiOkResponse({ type: PaymentHistoryItemDto, isArray: true })
  myPayments(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
  ) {
    return this.memberService.myPayments(session.user.id, churchId);
  }
}
