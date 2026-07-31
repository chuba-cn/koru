import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ErrorResponseDto, PaginationQueryDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MyProfileDto, PaymentHistoryPageDto, PledgeHistoryPageDto } from './member.dto';
import { MemberService } from './member.service';

@ApiTags('me')
@Controller('me')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({
    summary: 'The signed-in login: display name, phone, and every church membership',
    description:
      'memberships is cursor paginated. Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous.',
  })
  @ApiOkResponse({ type: MyProfileDto })
  @ApiBadRequestResponse({
    description: 'Malformed cursor/limit, cursor not found, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  getProfile(
    @Session() session: UserSession<typeof auth>,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.memberService.myProfile(
      session.user.id,
      session.user.name,
      session.user.phoneNumber ?? null,
      query,
    );
  }

  @Get('churches/:churchId/pledges')
  @ApiOperation({
    summary: "The signed-in member's pledges in one church",
    description:
      'Cursor paginated. Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous.',
  })
  @ApiOkResponse({ type: PledgeHistoryPageDto })
  @ApiBadRequestResponse({
    description: 'Malformed cursor/limit, cursor not found, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  myPledges(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.memberService.myPledges(session.user.id, churchId, query);
  }

  @Get('churches/:churchId/payments')
  @ApiOperation({
    summary: "The signed-in member's payments in one church",
    description:
      'Cursor paginated. Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous.',
  })
  @ApiOkResponse({ type: PaymentHistoryPageDto })
  @ApiBadRequestResponse({
    description: 'Malformed cursor/limit, cursor not found, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  myPayments(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.memberService.myPayments(session.user.id, churchId, query);
  }
}
