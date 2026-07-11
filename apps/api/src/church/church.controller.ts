import {
  CreateChurchInput,
  CreateChurchSchema,
  UpdateChurchInput,
  UpdateChurchSchema,
} from '@koru/shared';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChurchService } from './church.service';

@Controller('churches')
export class ChurchController {
  constructor(private readonly churchService: ChurchService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateChurchSchema)) body: CreateChurchInput) {
    return this.churchService.create(body);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.churchService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateChurchSchema)) body: UpdateChurchInput,
  ) {
    return this.churchService.update(id, body);
  }
}
