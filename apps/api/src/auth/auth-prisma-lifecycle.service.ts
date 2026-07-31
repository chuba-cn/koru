import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { disconnectAuthPrisma } from './auth';

// auth.ts's Prisma client is a bare module-level singleton, not Nest-managed —
// registering this as a provider gets it closed by the ordinary
// onModuleDestroy lifecycle too. See #94.
@Injectable()
export class AuthPrismaLifecycle implements OnModuleDestroy {
  async onModuleDestroy() {
    await disconnectAuthPrisma();
  }
}
