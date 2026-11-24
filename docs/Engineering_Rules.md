# Engineering rules

The conventions every change in this repository follows. Code comments that say
"see Engineering_Rules" point here.

## Conventions

- TypeScript strict everywhere (`noUncheckedIndexedAccess: true`).
- Named exports only (no `export default` except routers).
- Files under ~200 lines — split when they grow.
- Backend: `kebab-case.ts` files, `camelCase` variables. Frontend: `PascalCase.tsx` components, `useCamelCase` hooks.
- No `console.log` in server code — use the pino logger.
- **No silent mutations (frontend).** A global `MutationCache.onError` in `apps/web/src/app/App.tsx`
  shows a self-diagnosing toast (offline / network / HTTP status / code + reason) for any mutation
  without its own `onError` and without `meta: { errorHandled: true }`. Either rely on it, or handle
  errors at every call site and set `errorHandled` — never mark a hook handled without a handler.
- **Business dates are date-only.** `workStartDate`, `workEndDate`, `arrivedAt`, `documentsSubmittedAt`
  use a date input (DD.MM.YYYY); only system timestamps (`createdAt`, …) show time.

## Mutating endpoints (POST / PATCH / DELETE)

1. **Auth + role guard** — `requireAuth` and, where needed, `requireRole([...])` at router level.
2. **Zod validation** — every input goes through `zValidator('json' | 'query' | 'param', schema)`.
3. **Audit log on mutation** — every create / update / delete calls `audit.log({ actorId, action, entityType, entityId, oldValue, newValue, ip, userAgent })`.
4. **Delete: audit BEFORE remove** — so the trail survives a failed remove (GDPR traceability). See `candidates.service.ts:deleteCandidate`.
5. **Rate-limit public endpoints** — anything without `requireAuth` uses a dedicated limiter from `middleware/rate-limit.ts`.
6. **No PII in audit values** — sensitive operations audit boolean flags (`hadEmail`, `hadPhone`), not values. See `anonymize.service.ts`.
7. **No raw SQL with user input** — Drizzle parameterises; raw `sql` only for `now()`, `date_trunc`, integer math.

## Sensitive data and logging

- Never log secrets: the `lib/logger.ts` redact list must include every new secret-shaped field.
- Object-storage cleanup on erasure: `clients/r2.client.ts:deleteObject` is best-effort and never blocks the DB erasure.
- Use `buildReqCtx(c)` from `middleware/audit.ts` for IP / user agent (header order is configured once there).

## Database

- Foreign keys always state `ON DELETE` explicitly: `set null` for soft references, `cascade` only for children with no identity of their own.
- `onConflictDoNothing()` for inserts from webhooks / cron / external sources that can retry.
- Migrations are hand-written `.sql` files plus a `meta/_journal.json` entry. The drizzle-kit snapshot
  baseline is older than the migration chain, so `db:generate` would diff against the wrong schema.
- `when` in `_journal.json` must be strictly greater than every existing entry — the migrator compares
  `when` against the last applied `created_at`, so a smaller value is skipped silently.
- `db:push` is disabled: schema changes go through reviewed migration files only.

## Cron / background jobs

- Every job runs through `runOnce(name, fn)` in `cron/scheduler.ts` (overlap guard: a slow tick skips the next one instead of running concurrently).
- Every outbound `fetch` uses `AbortSignal.timeout(15_000)` — a hung connection must not poison the scheduler.

## Process resilience

- `index.ts` and `cron/scheduler.ts` register `unhandledRejection` / `uncaughtException` handlers.
- `db/client.ts` sets `connectionTimeoutMillis` and a driver-side `query_timeout` — fail fast rather than hang.
