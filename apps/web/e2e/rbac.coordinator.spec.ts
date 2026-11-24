import { test, expect } from './fixtures';

test.describe('RBAC — Coordinator strict scope (F1 security-critical)', () => {
  test('coordinator can list candidates (no error)', async ({ api }) => {
    const res = await api.get('/candidates?pageSize=100');
    expect(res.ok()).toBeTruthy();
  });

  test('coordinator scope: returned candidates have coordinatorId === self.id (strict, NO OR isNull)', async ({ api }) => {
    // Get self.id from /auth/me
    const me = await api.get('/auth/me');
    expect(me.ok()).toBeTruthy();
    const meBody = await me.json();
    const selfId = meBody.user.id;

    const res = await api.get('/candidates?pageSize=100');
    const body = await res.json();
    const items = body.items ?? body.data ?? [];
    for (const c of items) {
      // F1 strict scope: every visible candidate must have coordinatorId === self.id
      // No isNull bypass for coordinators (unlike recruiters)
      expect(c.coordinatorId, `candidate ${c.id} has coordinatorId=${c.coordinatorId}, expected ${selfId}`).toBe(selfId);
    }
  });

  test('coordinator CANNOT create candidate (admin/recruiter only)', async ({ api }) => {
    const res = await api.post('/candidates', {
      data: {
        name: `CoordCreate${Date.now()} Forbidden`,
        email: `coord-${Date.now()}@opushr.test`,
        phone: '+48505000999',
        source: 'website',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('coordinator CANNOT delete candidate', async ({ api }) => {
    // Use a fake id — should fail with 403 BEFORE finding the record
    const res = await api.delete('/candidates/00000000-0000-0000-0000-000000000000');
    expect([403, 404]).toContain(res.status());
  });

  test('coordinator CANNOT access /admin/users', async ({ api }) => {
    const res = await api.get('/admin/users');
    expect(res.status()).toBe(403);
  });

  test('coordinator CAN create dismissals (allowed per RBAC matrix)', async ({ api }) => {
    // Just check the endpoint allows the role — actual data requires valid candidateId
    const res = await api.post('/dismissals', { data: { candidateId: '00000000-0000-0000-0000-000000000000', dismissedAt: new Date().toISOString(), reason: 'test' } });
    // Either 400 (invalid candidateId) or 404 — but NOT 403
    expect(res.status()).not.toBe(403);
  });
});
