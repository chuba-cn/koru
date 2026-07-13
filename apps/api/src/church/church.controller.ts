import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/api.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChurchDto, CreateChurchDto, UpdateChurchDto } from './church.dto';
import { ChurchService } from './church.service';

@ApiTags('churches')
@Controller('churches')
export class ChurchController {
  constructor(private readonly churchService: ChurchService) {}

  @Post()
  @ApiOperation({ summary: 'Create a church' })
  @ApiCreatedResponse({ type: ChurchDto })
  @ApiBadRequestResponse({
    description: 'Validation failed (field errors in body)',
    type: ErrorResponseDto,
  })
  create(@Body(new ZodValidationPipe(CreateChurchDto.schema)) body: CreateChurchDto) {
    return this.churchService.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a church by ID' })
  @ApiOkResponse({ type: ChurchDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed UUID', type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.churchService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a church' })
  @ApiOkResponse({ type: ChurchDto })
  @ApiNotFoundResponse({ description: 'Church not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or malformed UUID',
    type: ErrorResponseDto,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateChurchDto.schema)) body: UpdateChurchDto,
  ) {
    return this.churchService.update(id, body);
  }
}
