# OPUS HR CRM — public demo

A production CRM for a Polish recruitment agency that places workers from Ukraine,
Poland and neighbouring countries in warehouses and factories. One person designed and
built it end to end, and the agency's recruiters, coordinators and admins use it every day.

This repository is a **cleaned demo copy** of that system. The code matches production, but
all data is fictional, external services are switched off, and the git history starts fresh
(see [What changed for the public demo](#what-changed-for-the-public-demo)).

- **Live demo:** _coming soon_ (`https://<demo-host>`)
- **Demo login:** `demo@opus-demo.example` / `demo-opus-2026` (admin). Also `recruiter@`,
  `coordinator@` and `readonly@opus-demo.example` with the same password, to see role-scoped views.
- Everything in the demo is invented, and the database is rebuilt every night at 03:00 UTC.

## What it does

- **Candidate pipeline:** an 8-stage lifecycle (`new → in_progress → documents_submitted → employed → re_employed → dismissed`, plus `cancelled` / `blacklist`), with a table and a Kanban view, bulk actions and inline edits
- **Clients and projects:** a hired candidate becomes a "client" managed by a coordinator. Projects (client sites) track the headcount they need against live placements
- **Public intake:** each recruiter has a personal application link (`/apply/:slug`) that assigns the candidate to them automatically, and collects the GDPR (RODO) consent
- **Communications:** e-mail / SMS templates, consent-filtered bulk send with a dry run, delivery and open tracking through signed webhooks
- **Analytics:** status funnel, recruiter and coordinator KPIs, source breakdown, retention by source built from employment episodes, and a dismissal register with XLSX export
- **GDPR:** consent ledger with withdrawal links, right-to-be-forgotten anonymisation, retention jobs, and an audit log of every change
- **Access control:** four roles (admin / recruiter / coordinator / readonly) with row-level scoping, TOTP two-factor login and rotating refresh sessions
- **UI in Polish and Ukrainian** (the public apply form also has English and Russian), installable as a PWA

## Architecture

```
apps/web  (React 19 + Vite, React Router, TanStack Query, Mantine, Zod)
    │  REST / JSON
    ▼
apps/api  (Hono on Node.js)
    routes → middleware (auth, roles, rate limits, audit) → services → repositories (Drizzle ORM)
    jobs + cron worker (separate Fly.io process)
    │
    ├── PostgreSQL (Drizzle migrations, run as a release step before each deploy)
    ├── S3-compatible object storage for files (Cloudflare R2)
    └── Resend for e-mail, SMSAPI.pl for SMS
packages/shared  (Zod schemas, types, error codes and route descriptors shared by web and api)
```

## Engineering highlights

- **One contract for both sides.** Zod schemas, enums, error codes and route descriptors live in `packages/shared`, so the API validates and the UI types against the same source. The DB `pgEnum`s are derived from the same constants, and a test guards against drift
- **Layered API.** Routes stay thin, business rules live in services, and SQL lives in repositories. Every mutation is validated by Zod and audited (the audit entry is written *before* a delete), and public endpoints have their own rate limiters
- **Security:** bcrypt (cost 12), short-lived JWT access tokens, rotating refresh sessions with a grace window for multi-tab races, TOTP 2FA (otplib), account lockout, strict security headers and a CORS allow-list. The pino logger redacts secrets and PII
- **GDPR by design:** anonymisation replaces personal fields and records only boolean flags in the audit log. Consents are versioned and withdrawable by token, and a cron worker runs retention sweeps
- **Operations:** two Fly.io processes (HTTP app + cron worker) from one image, migrations as an idempotent `release_command`, an esbuild production bundle (no `tsx` at runtime), a resource monitor and an event-loop watchdog
- **Backups:** a daily `pg_dump` → gzip → AES-256-GCM → object storage job, plus a restore-drill workflow that restores into a throwaway database and compares row counts per table (`.github/workflows/backup.yml`, `restore-drill.yml`)
- **Tests:** about 740 API unit tests and 85 web unit tests (Vitest, MSW, fast-check property tests), integration tests against a real PostgreSQL, and Playwright end-to-end suites per role

## Stack

TypeScript · React 19 · Vite · Mantine 7 · TanStack Query / Table · React Router 7 · i18next ·
Hono · Node.js 22 · PostgreSQL 17 · Drizzle ORM · Zod · pino · otplib · Resend · AWS S3 SDK (R2) ·
Vitest · Playwright · GitHub Actions · Docker · Fly.io

## Monorepo structure

```
apps/
  api/
    src/
      routes/          HTTP layer (Hono routers), one file per resource
      middleware/      auth, roles, audit context, rate limits, security headers, request log
      services/        business rules
      repositories/    Drizzle queries
      db/              schema, tables, hand-written SQL migrations
      clients/         R2, Resend, SMSAPI wrappers
      cron/ jobs/      cron worker, retention, backup / restore
      demo/            demo-mode guard, fictional seed data, nightly reset
      __tests__/       unit tests (integration/ needs a database)
    scripts/           production build, E2E seeding, restore verification
  web/
    src/features/      one folder per feature (candidates, dashboard, communications, …)
    src/locales/       pl / ua (+ en / ru for the public form)
    e2e/               Playwright specs per role
packages/shared/       Zod schemas, types, error codes, route registry
docs/Engineering_Rules.md   conventions every change follows
```

## Run locally

Requirements: Node.js 20+ and Docker (or any PostgreSQL 15+).

```bash
npm ci
docker compose up -d                       # PostgreSQL 17 on localhost:5432
cp .env.example .env                       # local defaults, DEMO_MODE=true
cp apps/web/.env.example apps/web/.env.local
npm run db:migrate -w @opushr/api          # apply migrations
npm run db:seed-demo -w @opushr/api        # fictional agency + demo users
npm run dev                                # api on :8080, web on :5173
```

Open http://localhost:5173. The sign-in form is pre-filled with the demo login.

To start over: `npm run db:reset-demo -w @opushr/api`. It drops the schema, re-applies every migration
and seeds again, and it refuses to run unless `DEMO_MODE=true`.

## Demo mode

`DEMO_MODE=true` (set in `fly.toml` for the demo app) changes four things:

- **E-mail and SMS never leave the process.** `clients/resend.client.ts` and `clients/smsapi.client.ts` log the attempt and report success, so bulk send and message history still work end to end
- **There is no object storage.** The R2 settings are not required, PDF uploads and downloads return `403 disabled_in_demo`, and deletes are no-ops
- **The shared guest login stays usable.** `demo/guard.ts` blocks password reset / change, 2FA enrolment, user management, invitations and registration. Everything else, including deleting candidates, stays writable
- **Nightly reset.** The cron worker seeds the demo on boot and rebuilds it at 03:00 UTC (`demo/reset.ts`)

The seed (`apps/api/src/demo/`) creates 8 staff users, 8 projects, 140 candidates spread across the
whole pipeline with employment episodes, dismissals, consents, comments, tasks, employer inquiries,
message templates, message history and two internal documents. Names are generic, e-mails use
`example.com`, and phones use the `+48 555` range. A fixed random seed keeps the data identical
after every reset, while dates stay relative to today.

## Tests and CI

```bash
npm run typecheck
npm run lint
npm run test -w @opushr/api                # unit tests, no database needed
npm run test -w @opushr/web
TEST_DATABASE_URL=postgres://opushr:opushr@localhost:5432/opushr npm run test:integration -w @opushr/api
```

`.github/workflows/test.yml` runs typecheck, lint, the API and web unit tests, the integration tests
and Playwright against a PostgreSQL service container. Pull requests get the smoke suite, and pushes
to `main` get the full suite for all five role projects. CI needs no secrets.

## What changed for the public demo

- **New git history.** The production history is not published
- **Removed:** internal docs and runbooks, client manuals, one-off data import scripts, production cleanup scripts, scratch files, the frontend FTP/SFTP deploy script and its dependencies, and editor / AI-assistant settings
- **Real data replaced:** the client's legal entity details, contact e-mail and phone (in the privacy texts), team member names, and client project names. They are now fictional placeholders, and test fixtures use `example.com` / `.example` / `.test` addresses
- **Production config neutralised:** the Fly app is a separate `opushr-demo` app, production domains became `*.opus-demo.example`, and production machine IDs were dropped from comments. CI uses a local PostgreSQL container instead of cloud database branches. The backup and restore-drill workflows are kept as reference implementations, but their schedule is off and they need secrets this repository does not have
- **Added:** demo mode (`apps/api/src/demo/`, small guards in `clients/`, `env.ts` and `cron/scheduler.ts`) with tests, a demo hint on the sign-in page, `docker-compose.yml` and `.env.example` files with placeholders only

## Author

Built by **Vitalii Opara**, full-stack developer in Wrocław — [u2use.com](https://u2use.com) ·
[github.com/Oparavitalii](https://github.com/Oparavitalii).

The demo data is fictional; any resemblance to real people or companies is coincidental.
