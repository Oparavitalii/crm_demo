import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';
process.env.APP_URL = 'http://localhost:3000';

// Mock the db client. findById uses db.query.users.findFirst; the write
// methods use db.update(...).set(...).where(...) (and .returning() for update).
// vi.hoisted keeps these mocks accessible from the hoisted vi.mock factory.
const { mockFindFirst, mockReturning } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockReturning: vi.fn().mockResolvedValue([]),
}));
vi.mock('../db/client', () => {
  const mockDb = {
    query: { users: { findFirst: mockFindFirst } },
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: mockReturning,
  };
  return { db: mockDb };
});

import * as usersRepo from '../repositories/users.repo';

const userRow = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
  role: 'recruiter' as const,
  isActive: true,
  isFreelancer: false,
  publicSlug: null,
  passwordHash: '$2b$12$hash',
  twoFactorSecret: null,
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Each test starts from a clean cache.
  usersRepo.bustUser('user-1');
});

describe('users.repo findById caching', () => {
  it('serves a second findById from cache without re-querying the DB', async () => {
    mockFindFirst.mockResolvedValue(userRow);

    const first = await usersRepo.findById('user-1');
    const second = await usersRepo.findById('user-1');

    expect(first).toEqual(userRow);
    expect(second).toEqual(userRow);
    expect(mockFindFirst).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it('does not cache a not-found result', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    await usersRepo.findById('user-1');
    await usersRepo.findById('user-1');

    expect(mockFindFirst).toHaveBeenCalledTimes(2); // undefined is never cached
  });

  it('busts the cache on lockAccount so the next read re-queries', async () => {
    mockFindFirst.mockResolvedValue(userRow);

    await usersRepo.findById('user-1'); // populates cache (1 query)
    await usersRepo.lockAccount('user-1', new Date(Date.now() + 60_000)); // busts
    await usersRepo.findById('user-1'); // must re-query (2 queries total)

    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it('busts the cache on remove', async () => {
    mockFindFirst.mockResolvedValue(userRow);

    await usersRepo.findById('user-1');
    await usersRepo.remove('user-1');
    await usersRepo.findById('user-1');

    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it('busts the cache on update and returns the updated row', async () => {
    mockFindFirst.mockResolvedValue(userRow);
    mockReturning.mockResolvedValueOnce([{ ...userRow, role: 'admin' }]);

    await usersRepo.findById('user-1'); // cache the old row (1 query)
    const updated = await usersRepo.update('user-1', { role: 'admin' });
    await usersRepo.findById('user-1'); // re-query after bust (2 queries)

    expect(updated?.role).toBe('admin');
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });
});
