import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/bcrypt';

describe('bcrypt', () => {
  it('hashes password to a 60-char bcrypt string starting with $2', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$2[ab]\$/);
    expect(hash.length).toBeGreaterThanOrEqual(60);
  });

  it('verifies a matching password', async () => {
    const hash = await hashPassword('s3cret-pa55');
    await expect(verifyPassword('s3cret-pa55', hash)).resolves.toBe(true);
  });

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('s3cret-pa55');
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('uses cost factor >= 12', async () => {
    const hash = await hashPassword('x');
    // bcrypt format: $2a$12$... — extract cost between 2nd and 3rd $
    const cost = parseInt(hash.split('$')[2] ?? '0', 10);
    expect(cost).toBeGreaterThanOrEqual(12);
  });
});
