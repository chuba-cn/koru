import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { auth } from '../auth/auth';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { ErrorResponseDto, PaginationQueryDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BranchDirectoryPageDto, JoinMemberDto, MemberDto } from './member.dto';
import { MemberService } from './member.service';

@ApiTags('join')
@Controller('join')
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
export class JoinController {
  constructor(private readonly memberService: MemberService) {}

  @Get(':churchId/branches')
  @ApiOperation({
    summary: "List a church's branches, for a join form",
    description:
      'Cursor paginated. Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous.',
  })
  @ApiOkResponse({ type: BranchDirectoryPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Malformed cursor/limit, cursor not found, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  listBranches(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Query(new ZodValidationPipe(PaginationQueryDto.schema)) query: PaginationQueryDto,
  ) {
    return this.memberService.listBranches(churchId, query);
  }

  @Post(':churchId')
  @UseGuards(VerifiedPhoneGuard)
  @ApiOperation({ summary: "Create or update the signed-in login's member profile in a church" })
  @ApiCreatedResponse({ type: MemberDto, description: 'New membership created' })
  @ApiOkResponse({ type: MemberDto, description: 'Existing membership updated' })
  @ApiForbiddenResponse({
    description: 'Session has no verified phone number',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Phone already linked to a different login',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, or homeBranchId not in this church',
    type: ErrorResponseDto,
  })
  async join(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
    @Body(new ZodValidationPipe(JoinMemberDto.schema)) body: JoinMemberDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { member, created } = await this.memberService.join(
      churchId,
      session.user.id,
      session.user.phoneNumber as string,
      body,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return member;
  }
}
