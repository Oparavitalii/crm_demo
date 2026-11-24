// Force IPv4-first DNS resolution. Neon's hostname resolves to IPv6 addresses
// first; on networks without working IPv6 (common on Windows/home routers) Node
// hangs ~30-60s on the IPv6 attempt before falling back to IPv4. Setting this
// before any imports that open sockets eliminates the cold-start stall.
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { env } from './env';
import { logger } from './lib/logger';
import * as sentry from './lib/sentry';
import { applySecurity } from './middleware/security';
import { demoGuard } from './demo/guard';

// Init Sentry before anything else. No-op when SENTRY_DSN_API is unset.
sentry.init();
import { errorHandler } from './middleware/error-handler';
import { requestLog } from './middleware/request-log';
import { startResourceMonitor } from './lib/resource-monitor';
import { startWatchdog } from './lib/watchdog';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { candidatesRouter, publicCandidatesRouter } from './routes/candidates';
import { candidateCommentsRouter } from './routes/candidate-comments';
import { adminUsersRouter } from './routes/admin/users';
import { adminUserStatsRouter } from './routes/admin/user-stats';
import { adminCandidatesRouter } from './routes/admin/candidates';
import { adminAuditLogRouter } from './routes/admin/audit-log';
import { analyticsRouter } from './routes/analytics';
import { dismissalsRouter } from './routes/dismissals';
import { accommodationsRouter } from './routes/accommodations';
import {
  employerInquiriesRouter,
  publicEmployerInquiriesRouter,
} from './routes/employer-inquiries';
import { communicationsRouter } from './routes/communications';
import { adminInvitationsRouter } from './routes/admin/invitations';
import { registerRouter } from './routes/register';
import { duplicatesRouter } from './routes/duplicates';
import { documentsRouter } from './routes/documents';
import { meRouter } from './routes/me';
import { adminDocumentsRouter } from './routes/admin/documents';
import { projectsRouter } from './routes/projects';
import { usersDirectoryRouter } from './routes/users-directory';
import { freelancersRouter } from './routes/freelancers';
import { tasksRouter } from './routes/tasks';
import {
  statusLookupsRouter,
  adminStatusLookupsRouter,
} from './routes/status-lookups';
import { reportsRouter } from './routes/reports';
import { publicConsentsRouter } from './routes/consents';
import { publicRecruitersRouter } from './routes/public-recruiters';
import { publicNationalitiesRouter } from './routes/public-nationalities';
import { resendWebhookRouter } from './routes/webhooks/resend';
import { smsapiWebhookRouter } from './routes/webhooks/smsapi';

const app = new Hono();

// Outermost, ahead of CORS and secure-headers, so the recorded duration is
// the whole time the request spent inside the process.
app.use('*', requestLog);

applySecurity(app);

// No-op unless DEMO_MODE=true. After CORS so a refused request still carries
// the headers the browser needs to read the 403.
app.use('*', demoGuard);

app.route('/auth', authRouter);
app.route('/health', healthRouter);
app.route('/candidates', candidatesRouter);
app.route('/candidates', candidateCommentsRouter);
app.route('/admin/users', adminUsersRouter);
// Per-user analytics drill-down. Mounted under /admin/users so the URL is
// /admin/users/:userId/stats, but auth allows self-access in addition to
// admin (see analytics.service.getUserProfileStats).
app.route('/admin/users', adminUserStatsRouter);
app.route('/admin/candidates', adminCandidatesRouter);
app.route('/admin/audit-log', adminAuditLogRouter);
app.route('/analytics', analyticsRouter);
app.route('/dismissals', dismissalsRouter);
app.route('/accommodations', accommodationsRouter);
app.route('/employer-inquiries', employerInquiriesRouter);
app.route('/public/employer-inquiries', publicEmployerInquiriesRouter);
// 2026-06-12: leads entity retired. Public submissions now go to candidates
// directly. /public/leads stays mounted as a legacy alias so the agency website
// PHP contact form and Make.com (FB Lead Ads) keep working unmodified.
app.route('/public/candidates', publicCandidatesRouter);
app.route('/public/leads', publicCandidatesRouter);
app.route('/communications', communicationsRouter);
app.route('/admin/invitations', adminInvitationsRouter);
app.route('/register', registerRouter);
app.route('/duplicates', duplicatesRouter);
app.route('/documents', documentsRouter);
app.route('/me', meRouter);
app.route('/admin/documents', adminDocumentsRouter);
app.route('/projects', projectsRouter);
app.route('/users-directory', usersDirectoryRouter);
app.route('/freelancers', freelancersRouter);
app.route('/tasks', tasksRouter);
app.route('/status-lookups', statusLookupsRouter);
app.route('/admin/status-lookups', adminStatusLookupsRouter);
app.route('/reports', reportsRouter);
app.route('/public/consents', publicConsentsRouter);
app.route('/public/recruiters', publicRecruitersRouter);
app.route('/public/nationalities', publicNationalitiesRouter);
app.route('/webhooks/resend', resendWebhookRouter);
app.route('/webhooks/smsapi', smsapiWebhookRouter);

app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));

// Warm-up Neon at boot. Fly machine boots faster than Neon wakes from
// scale-to-zero, so the first incoming request would otherwise time out
// inside requireAuth's session/user lookups and surface as 500. Pinging
// the pool here forces the cold-start cost onto our startup, not users.
// Best-effort: a failure here just means the next request will retry.
try {
  const { sql } = await import('drizzle-orm');
  const { db } = await import('./db/client');
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  logger.info({ ms: Date.now() - t0 }, 'db warm-up ok');
} catch (err) {
  logger.warn({ err }, 'db warm-up failed');
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'API started');
});

// Emits `resources` once a minute: rss/heap, event-loop lag, pg pool queue
// depth. Started after serve() so a failure here can never delay the listener.
startResourceMonitor();

// Production only — in development a debugger breakpoint parks the event loop
// for minutes, which is not a wedge.
if (env.NODE_ENV === 'production') startWatchdog();

// Last-line-of-defense handlers. Without these a stray rejection in a route
// handler escapes Hono and crashes the process silently — Fly restarts but
// you have no log of the cause.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'api_unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'api_uncaught_exception');
  // Process is in an unknown state — exit so Fly restarts cleanly.
  process.exit(1);
});

// Graceful shutdown — Fly sends SIGTERM on machine stop/restart.
// Without this, Neon pool sockets are cut mid-request.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down API');
    server.close(() => process.exit(0));
    // Force-exit if server.close hangs > 10s (open keep-alive connections)
    setTimeout(() => {
      logger.warn('Force exit after 10s grace');
      process.exit(1);
    }, 10_000).unref();
  });
}
