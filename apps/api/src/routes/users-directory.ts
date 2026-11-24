import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { directoryQuerySchema } from '@opushr/shared';
import { db } from '../db/client';
import { users } from '../db/tables/users';
import { requireAuth } from '../middleware/auth';

// Lightweight read-only directory for picking team members in selects
// (coordinator at promotion, recruiter filter in retention report).
// Returns just id + names + role + isActive — no email, 2FA, or login times.
// Available to all authenticated users.
//
// `includeInactive=true` opts into showing deactivated users too — used by
// the candidate form so admins can reassign a candidate to a previous
// recruiter/coordinator who has since been deactivated. Default stays
// "active only" to keep legacy callers untouched.
export const usersDirectoryRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', directoryQuerySchema), async (c) => {
    const { role, includeInactive } = c.req.valid('query');
    const clauses: SQL[] = [];
    if (!includeInactive) clauses.push(eq(users.isActive, true));
    if (role) clauses.push(eq(users.role, role));
    const where = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
    const items = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(where)
      .orderBy(asc(users.firstName), asc(users.lastName));
    return c.json({ items });
  });
