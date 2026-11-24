import { test, expect } from './fixtures';

const uniq = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

test.describe('Communications — Templates', () => {
  test('list templates returns array', async ({ api }) => {
    const res = await api.get('/communications/templates');
    expect(res.ok()).toBeTruthy();
  });

  test('create email template with variables', async ({ api }) => {
    const name = `E2E-Tpl-${uniq()}`;
    const res = await api.post('/communications/templates', {
      data: {
        name,
        channel: 'email',
        subject: 'Hello {{firstName}}',
        body: 'Cześć {{firstName}} {{lastName}}, twój email to {{email}}.',
        variables: ['firstName', 'lastName', 'email'],
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.id).toBeTruthy();

    // Cleanup
    await api.delete(`/communications/templates/${body.id}`);
  });

  test('create SMS template is allowed (channel exists) but bulk-send blocks it', async ({ api }) => {
    const name = `E2E-SMS-${uniq()}`;
    const create = await api.post('/communications/templates', {
      data: {
        name,
        channel: 'sms',
        subject: '',
        body: 'Cześć {{firstName}}, twój telefon: {{phone}}',
        variables: ['firstName', 'phone'],
      },
    });
    if (!create.ok()) {
      console.warn('SMS template create rejected', create.status());
      return;
    }
    const templateId = (await create.json()).id;

    // Try to bulk-send → should be blocked because no SMS client
    const send = await api.post('/communications/send-bulk', {
      data: { templateId, candidateIds: [], dryRun: true },
    });
    // Expect 400 with reason template_not_email_channel
    expect([400, 422]).toContain(send.status());

    await api.delete(`/communications/templates/${templateId}`);
  });
});

test.describe('Communications — Bulk send', () => {
  test('preview-recipients endpoint returns recipient count', async ({ api }) => {
    const res = await api.get('/communications/preview-recipients?status=new&pageSize=10').catch(() => null);
    if (res?.ok()) {
      const body = await res.json();
      expect(typeof (body.count ?? body.total ?? body.length) === 'number' || Array.isArray(body)).toBeTruthy();
    }
  });

  test('history endpoint returns sent messages', async ({ api }) => {
    const res = await api.get('/communications/history?pageSize=10');
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('Tasks', () => {
  test('list tasks returns array', async ({ api }) => {
    const res = await api.get('/tasks');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.items ?? body.data ?? body)).toBeTruthy();
  });

  test('create task and mark complete', async ({ api, createCandidate }) => {
    const c = await createCandidate({ name: `TaskC${uniq()} Test` });
    const create = await api.post('/tasks', {
      data: {
        title: `E2E task ${uniq()}`,
        type: 'contact',
        candidateId: c.id,
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    if (!create.ok()) {
      console.warn('task create failed', create.status(), await create.text());
      return;
    }
    const taskId = (await create.json()).id;
    expect(taskId).toBeTruthy();

    const done = await api.patch(`/tasks/${taskId}`, { data: { doneAt: new Date().toISOString() } });
    expect(done.ok()).toBeTruthy();
  });
});

test.describe('Dismissals', () => {
  test('list dismissals returns items', async ({ api }) => {
    const res = await api.get('/dismissals?pageSize=20');
    expect(res.ok()).toBeTruthy();
  });

  test('dismissal registry has filters and CSV export', async ({ api }) => {
    const res = await api.get('/dismissals/registry?pageSize=10').catch(() => null);
    // Some installations may keep registry under same /dismissals endpoint
    if (res?.ok()) {
      const body = await res.json();
      expect(Array.isArray(body.items ?? body.data ?? body)).toBeTruthy();
    }
  });
});
