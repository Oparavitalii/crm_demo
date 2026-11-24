import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { randomUUID, createHash } from 'node:crypto';

export { expect };

// Load .env from project root for DB + JWT secrets
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
const __dirname2 = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname2, '../../../.env') });

const PROJECT_TO_EMAIL: Record<string, string> = {
  'chromium-admin': 'e2e-admin@crm.test',
  'chromium-recruiter': 'e2e-recruiter@crm.test',
  'chromium-coordinator': 'e2e-coordinator@crm.test',
  'chromium-readonly': 'e2e-readonly@crm.test',
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
});

// Reuse same access key for all sign operations
const accessKey = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

// Issue a fresh access token by inserting a session row + signing JWT.
// Survives /auth/refresh rotation because each test gets its own session.
async function issueFreshToken(email: string): Promise<string> {
  const u = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
  if (!u.rows.length) throw new Error(`User not found: ${email}`);
  const { id: userId, role } = u.rows[0];

  const sid = randomUUID();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const dummyHash = createHash('sha256').update(sid).digest('hex');

  await pool.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [sid, userId, dummyHash, expiresAt],
  );

  return await new SignJWT({ sub: userId, role, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('crm-demo')
    .setIssuedAt()
    .setExpirationTime('6h')
    .sign(accessKey);
}

type ApiHelpers = {
  api: APIRequestContext;
  authedPage: Page;
  createCandidate: (data?: Partial<CandidatePayload>) => Promise<{ id: string; email: string }>;
  deleteCandidate: (id: string) => Promise<void>;
  randomEmail: (prefix?: string) => string;
};

type CandidatePayload = {
  name: string;
  email: string;
  phone: string;
  source: string;
  recruiterId?: string | null;
};

export const test = base.extend<ApiHelpers>({
  api: async ({ playwright, baseURL }, use, testInfo) => {
    const apiBase = (baseURL ?? 'http://localhost:5173').replace('5173', '8080');
    const email = PROJECT_TO_EMAIL[testInfo.project.name];
    if (!email) throw new Error(`Unknown project: ${testInfo.project.name}`);
    // Fresh token per-test — survives /auth/refresh rotation in UI tests
    const token = await issueFreshToken(email);
    const api = await playwright.request.newContext({
      baseURL: apiBase,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    await use(api);
    await api.dispose();
  },
  // authedPage: navigates to /, captures fresh accessToken from /auth/refresh response,
  // then provides a page where window.fetch is auto-authed. Use this for UI tests.
  authedPage: async ({ page, baseURL }, use) => {
    let freshToken: string | null = null;
    page.on('response', async (response) => {
      if (response.url().endsWith('/auth/refresh') && response.ok()) {
        try {
          const body = await response.json();
          if (body.accessToken) freshToken = body.accessToken;
        } catch {}
      }
    });
    await page.goto('/');
    // Wait for /auth/refresh response to land
    await page.waitForResponse((r) => r.url().endsWith('/auth/refresh'), { timeout: 10_000 }).catch(() => null);
    // Wait a brief moment for app to finish boot
    await page.waitForLoadState('networkidle').catch(() => null);
    if (!freshToken) {
      throw new Error('Page did not receive a fresh access token from /auth/refresh');
    }
    await use(page);
  },
  randomEmail: async ({}, use) => {
    await use((prefix = 'e2e') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@crm.test`);
  },
  createCandidate: async ({ api, randomEmail }, use) => {
    const created: string[] = [];
    await use(async (data = {}) => {
      const email = data.email ?? randomEmail('cand');
      const res = await api.post('/candidates', {
        data: {
          name: data.name ?? `TestCand Doe-${Math.random().toString(36).slice(2, 6)}`,
          email,
          phone: data.phone ?? `+48${Math.floor(100000000 + Math.random() * 899999999)}`,
          source: data.source ?? 'website',
          ...(data.recruiterId !== undefined ? { recruiterId: data.recruiterId } : {}),
        },
      });
      if (!res.ok()) throw new Error(`createCandidate failed ${res.status()}: ${await res.text()}`);
      const body = await res.json();
      created.push(body.id);
      return { id: body.id, email };
    });
  },
  deleteCandidate: async ({ api }, use) => {
    await use(async (id) => {
      await api.delete(`/candidates/${id}`);
    });
  },
});

export async function fillField(page: Page, label: RegExp | string, value: string) {
  await page.getByLabel(label).first().fill(value);
}
