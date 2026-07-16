import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: requireEnv('DATABASE_URL'),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
