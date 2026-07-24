import { type AcceptInviteInput, AcceptInviteSchema } from '@koru/shared';
import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AcceptInviteService } from './accept-invite.service';
import { AcceptInviteResponseDto } from './staff.dto';

@ApiTags('invites')
@Controller('invites')
export class AcceptInviteController {
  constructor(private readonly acceptInvite: AcceptInviteService) {}

  @Post('accept')
  @AllowAnonymous()
  @ApiOperation({
    summary:
      'Accept a staff invite, setting a password. Returns 201 — the caller must verify their email before signing in.',
  })
  @ApiCreatedResponse({ type: AcceptInviteResponseDto })
  @ApiConflictResponse({
    description: 'Already accepted, or the email already has a login',
    type: ErrorResponseDto,
  })
  async accept(
    @Body(new ZodValidationPipe(AcceptInviteSchema)) body: AcceptInviteInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { staff, cookies } = await this.acceptInvite.accept(body);
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    return staff;
  }
}
