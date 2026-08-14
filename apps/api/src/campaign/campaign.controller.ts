import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CallerStaff } from '../auth/caller-staff.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { TenantGuard, TenantStaff } from '../auth/tenant.guard';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CampaignDto,
  CampaignPageDto,
  CreateCampaignDto,
  ListCampaignsQueryDto,
  UpdateCampaignDto,
} from './campaign.dto';
import { CampaignService } from './campaign.service';

@ApiTags('campaigns')
@Controller('churches/:churchId/campaigns')
@UseGuards(TenantGuard)
@ApiUnauthorizedResponse({ description: 'No active session', type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Church does not belong to the session, or the role cannot manage campaigns',
  type: ErrorResponseDto,
})
export class CampaignController {
  constructor(private readonly service: CampaignService) {}

  @Post()
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin', 'finance')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Create a campaign at church, region or branch level',
    description:
      "A church-level campaign is super_admin only. A region-level campaign additionally admits regional_admin and finance; a branch-level campaign also admits branch_admin, and delegated callers must hold a scope covering the target. The settlement account's own scope must cover or equal the campaign's scope, upward is allowed (a branch campaign may bank into its region's or the church's account), downward is never allowed",
  })
  @ApiCreatedResponse({ type: CampaignDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, malformed UUID, scopeRefId not a region/branch of this church, ' +
      'settlementAccountId not an account of this church, or an account whose scope does not cover this campaign',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'Church does not belong to the session, the role may not create a campaign at this scope level, or the caller has no scope covering it',
    type: ErrorResponseDto,
  })
  create(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(CreateCampaignDto.schema)) body: CreateCampaignDto,
  ) {
    return this.service.create(churchId, caller, body);
  }

  @Get()
  @ApiOperation({
    summary: 'List campaigns, optionally filtered by status, scope or settlement account',
    description:
      'A super_admin sees every campaign. A delegated caller sees church-wide campaigns, the campaigns of the regions and branches their own scope covers, and nothing else. Cursor paginated, ordered by title (id as tiebreaker). Send the response "endCursor" value as "cursor" with "direction=forward" for Next, or the response "startCursor" value as "cursor" with "direction=backward" for previous',
  })
  @ApiOkResponse({ type: CampaignPageDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed cursor/limit, cursor not found or not visible to the caller, or direction=backward with no cursor',
    type: ErrorResponseDto,
  })
  list(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @CallerStaff() caller: TenantStaff,
    @Query(new ZodValidationPipe(ListCampaignsQueryDto.schema)) query: ListCampaignsQueryDto,
  ) {
    return this.service.list(churchId, caller, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one campaign',
    description:
      'Narrowed by the same scope rule as the list, so a campaign the caller could not list is a 404 here too',
  })
  @ApiOkResponse({ type: CampaignDto })
  @ApiNotFoundResponse({ description: 'Church or campaign not found', type: ErrorResponseDto })
  findById(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
  ) {
    return this.service.findById(churchId, caller, id);
  }

  @Patch(':id')
  @StaffRoles('super_admin', 'regional_admin', 'branch_admin', 'finance')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Update a campaign',
    description:
      "Authorized against the stored campaign's scope, and against the requested scope as well when the scope changes. The settlement account cannot be repointed once any Payment exists for the campaign, and the scope cannot change once any DonationIntent or Payment exists",
  })
  @ApiOkResponse({ type: CampaignDto })
  @ApiNotFoundResponse({ description: 'Church or campaign not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, malformed UUID, a scope or settlement account not belonging to this church, or an account whose scope does not cover this campaign',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      "Church does not belong to the session, or the caller may not act on this campaign's current or requested scope",
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'The campaign already has settled Payments (settlement account is locked) or existing giving (scope is locked)',
    type: ErrorResponseDto,
  })
  update(
    @Param('churchId', ParseUUIDPipe) churchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CallerStaff() caller: TenantStaff,
    @Body(new ZodValidationPipe(UpdateCampaignDto.schema)) body: UpdateCampaignDto,
  ) {
    return this.service.update(churchId, id, caller, body);
  }
}
