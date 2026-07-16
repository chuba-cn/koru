import type { UpdateChurchInput } from '@koru/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Churches are created only by OnboardingService, via signup -> bootstrap. There
 * is deliberately no create method here: a second creation path would let a
 * church exist without a founding super_admin.
 */
@Injectable()
export class ChurchService {
  constructor(private readonly prisma: PrismaService) {}

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
