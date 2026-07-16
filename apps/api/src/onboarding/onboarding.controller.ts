import { type BootstrapChurchInput, BootstrapChurchSchema } from '@koru/shared';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('church')
  @ApiOperation({ summary: 'Create a church with the signed-in account as its first super_admin' })
  @ApiCreatedResponse({ description: 'Church + founding super_admin created' })
  @ApiConflictResponse({
    description: 'Account already administers a church',
    type: ErrorResponseDto,
  })
  bootstrap(
    @Session() session: UserSession<typeof auth>,
    @Body(new ZodValidationPipe(BootstrapChurchSchema)) body: BootstrapChurchInput,
  ) {
    return this.onboardingService.bootstrapChurch(session.user, body);
  }
}
