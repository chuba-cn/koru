import { bigintToKobo, type Donation } from '@koru/shared';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { auth } from '../auth/auth';
import { VerifiedPhoneGuard } from '../auth/verified-phone.guard';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { DonationIntent, PaymentAttempt } from '../generated/prisma/client';
import { CreateDonationDto, DonationDto } from './donation.dto';
import { DonationIntentService } from './donation-intent.service';

function toDonation(intent: DonationIntent, attempt: PaymentAttempt | null): Donation {
  return {
    id: intent.id,
    campaignId: intent.campaignId,
    pledgeId: intent.pledgeId,
    amountKobo: bigintToKobo(intent.amountKobo),
    status: intent.status,
    createdAt: intent.createdAt.toISOString(),
    transferInstruction:
      attempt?.virtualAccountNumber && attempt.virtualAccountBank && attempt.expiresAt
        ? {
            reference: attempt.id,
            accountNumber: attempt.virtualAccountNumber,
            bankName: attempt.virtualAccountBank,
            accountName: attempt.virtualAccountName,
            amountKobo: bigintToKobo(attempt.amountKobo),
            expiresAt: attempt.expiresAt.toISOString(),
          }
        : null,
  };
}

@ApiTags('me')
@Controller('me/churches/:churchId/donations')
@ApiUnauthorizedResponse({ description: 'No active session ', type: ErrorResponseDto })
export class DonationController {
  constructor(private readonly donationIntents: DonationIntentService) {}

  @Post()
  @UseGuards(VerifiedPhoneGuard)
  @ApiOperation({
    summary: 'Start a donation and get a one-time bank account to transfer into',
    description:
      'Creates a Donation Intent and a Pay-with-Transfer Payment Attempt. Supply a fresh uuid ' +
      'as idempotencyKey per intent-to-give and reuse it on retries: a repeat returns 200 with ' +
      'the existing donation instead of creating a second charge. Reusing a key for a different ' +
      'campaign, pledge or amount returns 409, as does replaying a key whose donation already ' +
      'failed or expired - start a new one with a fresh key.',
  })
  @ApiCreatedResponse({
    type: DonationDto,
    description: 'Donation created; payment carries the account to transfer into',
  })
  @ApiOkResponse({ type: DonationDto, description: 'Idempotency key replayed' })
  @ApiForbiddenResponse({
    description: 'Session has no verified phone number',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Not a member of this church, or campaign not found in this church',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'Too many donations already in flight, or the idempotencyKey was used for a different or ' +
      'already-dead donation',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, campaign is not active or not NGN, pledge does not belong to the ' +
      'campaign, or the settlement account is not set up to receive online gifts yet',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The payment gateway could not create the charge',
    type: ErrorResponseDto,
  })
  async create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Session() session: UserSession<typeof auth>,
    @Body(new ZodValidationPipe(CreateDonationDto.schema)) body: CreateDonationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { intent, attempt, replayed } = await this.donationIntents.createForUser(
      session.user.id,
      churchId,
      body,
    );

    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return toDonation(intent, attempt);
  }

  @Get(':id')
  @UseGuards(VerifiedPhoneGuard)
  @ApiOperation({
    summary: 'Read one of your own donations, including its transfer instructions',
    description:
      'Poll this after a create that returned a null transferInstruction, or to recover the ' +
      'account number after leaving the page. Only ever returns the caller own donations.',
  })
  @ApiOkResponse({ type: DonationDto })
  @ApiForbiddenResponse({
    description: 'Session has no verified phone number',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Not a member of this church, or no such donation of yours',
    type: ErrorResponseDto,
  })
  async findOne(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession<typeof auth>,
  ) {
    const { intent, attempt } = await this.donationIntents.findForUser(
      session.user.id,
      churchId,
      id,
    );
    return toDonation(intent, attempt);
  }
}
