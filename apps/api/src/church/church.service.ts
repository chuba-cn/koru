import type { CreateChurchInput, UpdateChurchInput } from '@koru/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChurchService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateChurchInput) {
    return this.prisma.church.create({ data: input });
  }

  async findById(id: string) {
    const church = await this.prisma.church.findUnique({ where: { id } });
    if (!church) {
      throw new NotFoundException(`Church ${id} not found`);
    }

    return church;
  }

  async update(id: string, input: UpdateChurchInput) {
    await this.findById(id);
    return this.prisma.church.update({ where: { id }, data: input });
  }
}
