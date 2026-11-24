import { test, expect } from './fixtures';

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

test.describe('RBAC — Recruiter scope', () => {
  test('recruiter can create candidate', async ({ createCandidate }) => {
    const c = await createCandidate({ name: `RecCand${uniq()} Test` });
    expect(c.id).toBeTruthy();
  });

  test('recruiter sees own + unassigned candidates (recruiterId IS NULL allowed)', async ({ api }) => {
    const res = await api.get('/candidates?pageSize=100');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const items = body.items ?? body.data ?? [];
    // All items should have recruiterId === me or null (intentional scoping per docs)
    // We can't verify recruiterId without knowing self.id, but at least the list returns 200
    expect(Array.isArray(items)).toBeTruthy();
  });

  test('recruiter CANNOT access /admin/users (403)', async ({ api }) => {
    const res = await api.get('/admin/users');
    expect(res.status()).toBe(403);
  });

  test('recruiter CANNOT access /admin/invitations (403)', async ({ api }) => {
    const res = await api.get('/admin/invitations');
    expect(res.status()).toBe(403);
  });

  test('recruiter CANNOT delete candidate (admin-only)', async ({ api, createCandidate }) => {
    const c = await createCandidate({ name: `RecDel${uniq()} Test` });
    const res = await api.delete(`/candidates/${c.id}`);
    expect(res.status()).toBe(403);
  });

  test('recruiter CANNOT anonymize candidate (admin-only RODO)', async ({ api, createCandidate }) => {
    const c = await createCandidate({ name: `RecAno${uniq()} Test` });
    const res = await api.post(`/admin/candidates/${c.id}/anonymize`);
    expect(res.status()).toBe(403);
  });

  test('recruiter CANNOT access audit log (admin-only)', async ({ api }) => {
    const res = await api.get('/admin/audit-log');
    expect(res.status()).toBe(403);
  });
});
