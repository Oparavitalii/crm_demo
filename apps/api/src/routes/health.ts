import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export const healthRouter = new Hono()
  // Liveness — process alive. NO DB call. Fly's internal health-check pings
  // this every 30s; touching the DB here would keep Neon awake and defeat
  // scale-to-zero. Used by fly.toml and any external monitor.
  .get('/', (c) => c.json({ status: 'ok' }))
  // Readiness — verifies DB reachable. Called by the LoginPage warm-up to
  // wake Neon from scale-to-zero while the user is typing credentials, and
  // for manual debugging.
  .get('/ready', async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: 'ok', db: 'reachable', ts: new Date().toISOString() });
    } catch {
      return c.json({ status: 'error', db: 'unreachable' }, 503);
    }
  });
