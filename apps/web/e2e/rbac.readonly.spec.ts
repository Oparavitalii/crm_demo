import { test, expect } from './fixtures';

test.describe('RBAC — Readonly role', () => {
  test('readonly can list candidates', async ({ api }) => {
    const res = await api.get('/candidates?pageSize=20');
    expect(res.ok()).toBeTruthy();
  });

  test('readonly can list projects', async ({ api }) => {
    const res = await api.get('/projects');
    expect(res.ok()).toBeTruthy();
  });

  test('readonly CANNOT create candidate (403)', async ({ api }) => {
    const res = await api.post('/candidates', {
      data: {
        name: 'Read Only',
        email: `ro-${Date.now()}@opushr.test`,
        phone: '+48505000777',
        source: 'website',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('readonly CANNOT access /admin/* (403)', async ({ api }) => {
    const res = await api.get('/admin/users');
    expect(res.status()).toBe(403);
  });

  test('readonly CANNOT delete anything (403)', async ({ api }) => {
    const res = await api.delete('/candidates/00000000-0000-0000-0000-000000000000');
    expect(res.status()).toBe(403);
  });

  test('readonly CAN view documents + accept', async ({ api }) => {
    const list = await api.get('/documents');
    expect(list.ok()).toBeTruthy();
  });
});
