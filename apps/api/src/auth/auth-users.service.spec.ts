import { describe, expect, it, vi } from 'vitest';
import { AuthUsersService } from './auth-users.service';

const { findUserByEmail, deleteUser } = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { findUserByEmail, deleteUser } }) },
}));

describe('AuthUsersService', () => {
  describe('findByEmail', () => {
    it('lower-cases the address before looking it up, since Better Auth stores emails lower-case', async () => {
      findUserByEmail.mockResolvedValue({ user: { id: 'user-1' } });
      const service = new AuthUsersService();

      await service.findByEmail('Ada@Example.TEST');

      expect(findUserByEmail).toHaveBeenCalledWith('ada@example.test');
    });

    it('returns null rather than throwing when no user holds the address', async () => {
      findUserByEmail.mockResolvedValue(null);
      const service = new AuthUsersService();

      await expect(service.findByEmail('nobody@example.test')).resolves.toBeNull();
    });

    it('unwraps the user from the adapter row', async () => {
      const user = { id: 'user-1', email: 'ada@example.test' };
      findUserByEmail.mockResolvedValue({ user });
      const service = new AuthUsersService();

      await expect(service.findByEmail('ada@example.test')).resolves.toEqual(user);
    });
  });

  describe('delete', () => {
    it('delegates to the internal adapter with the given id', async () => {
      deleteUser.mockResolvedValue(undefined);
      const service = new AuthUsersService();

      await service.delete('user-1');

      expect(deleteUser).toHaveBeenCalledWith('user-1');
    });
  });
});
