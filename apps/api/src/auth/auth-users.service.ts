import { Injectable, Logger } from '@nestjs/common';
import { auth } from './auth';

/**
 * Wraps Better Auth's internalAdapter, which is a semi-public API. Keeping the
 * calls here means an upgrade that changes them breaks one file, and the e2e
 * suite catches it.
 */
@Injectable()
export class AuthUsersService {
  private readonly logger = new Logger(AuthUsersService.name);

  private async context() {
    return auth.$context;
  }

  async findByEmail(email: string) {
    const ctx = await this.context();
    const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
    return found?.user ?? null;
  }

  async delete(userId: string) {
    const ctx = await this.context();
    await ctx.internalAdapter.deleteUser(userId);
    this.logger.warn(`Deleted Better Auth user ${userId}`);
  }
}
