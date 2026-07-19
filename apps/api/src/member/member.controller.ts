import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth';
import { ErrorResponseDto } from '../common/api.dto';
import { MyProfileDto } from './member.dto';
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
}
