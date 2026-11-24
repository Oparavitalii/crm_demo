import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { CONSENT_SOURCES, CONSENT_TYPES, CONSENT_VERSIONS } from '@crm/shared';
import { db } from '../db/client';
import { users } from '../db/tables/users';
import { projects } from '../db/tables/projects';
import { candidates } from '../db/tables/candidates';
import { consents, type NewConsent } from '../db/tables/consents';
import { employmentPeriods } from '../db/tables/employment-periods';
import { dismissals } from '../db/tables/dismissals';
import { candidateComments } from '../db/tables/candidate-comments';
import { tasks } from '../db/tables/tasks';
import { employerInquiries } from '../db/tables/employer-inquiries';
import { messageTemplates, messages } from '../db/tables/messages';
import { documents } from '../db/tables/documents';
import { env } from '../env';
import { hashPassword } from '../lib/bcrypt';
import { between, buildCandidates, createRng, pick } from './candidates';
import { COMMENTS, PROJECTS, STAFF, TASKS } from './fixtures';
import { DOCUMENTS, INQUIRIES, TEMPLATES } from './content';

const DAY = 24 * 60 * 60 * 1000;

export interface DemoSeedSummary {
  skipped: boolean;
  users: number;
  candidates: number;
}

// Seeds a complete fictional agency. Idempotent: if the demo user already
// exists the call is a no-op, so it is safe to run on every boot or deploy.
export async function seedDemo(now = new Date()): Promise<DemoSeedSummary> {
  const demoEmail = env.DEMO_USER_EMAIL.toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, demoEmail) });
  if (existing) return { skipped: true, users: 0, candidates: 0 };

  const rng = createRng(20261124);
  const loginHash = await hashPassword(env.DEMO_USER_PASSWORD);
  const lockedHash = await hashPassword(randomBytes(32).toString('base64url'));
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  return db.transaction(async (tx) => {
    const staff = await tx
      .insert(users)
      .values(
        STAFF.map((s) => ({
          email: s.key === 'demo' ? demoEmail : s.email,
          passwordHash: s.canLogin ? loginHash : lockedHash,
          firstName: s.firstName,
          lastName: s.lastName,
          role: s.role,
          isFreelancer: s.isFreelancer ?? false,
          publicSlug: s.publicSlug ?? null,
          isActive: true,
          createdAt: ago(200),
        })),
      )
      .returning({ id: users.id, role: users.role });
    const idsOf = (role: string) => staff.filter((u) => u.role === role).map((u) => u.id);
    const recruiters = idsOf('recruiter');
    const coordinators = idsOf('coordinator');
    const adminId = idsOf('admin')[0]!;

    // Upsert by name: migration 0014 already inserted the first seven.
    const projectRows = [];
    for (const p of PROJECTS) {
      const values = {
        name: p.name,
        isActive: p.isActive,
        notes: p.notes,
        headcountNeeded: p.headcountNeeded,
        startDate: new Date(now.getTime() + p.startInDays * DAY).toISOString().slice(0, 10),
        // Baseline before every seeded placement, so progress bars are filled.
        headcountResetAt: ago(200),
      };
      const [row] = await tx
        .insert(projects)
        .values(values)
        .onConflictDoUpdate({ target: projects.name, set: values })
        .returning({ id: projects.id, isActive: projects.isActive });
      projectRows.push(row!);
    }
    const activeProjects = projectRows.filter((p) => p.isActive).map((p) => p.id);

    const people = buildCandidates(rng, { recruiters, coordinators }, activeProjects, now);

    // RODO processing basis for everyone (as the intake flow records it), plus
    // marketing opt-ins for some, so bulk-send consent filtering has work to do.
    // Inserted before candidates: candidates.consent_id points at the basis row.
    const consentRows = people.flatMap(({ row }) => {
      const base = { candidateEmail: row.email ?? null, candidatePhone: row.phone ?? null, acceptedAt: row.createdAt, source: CONSENT_SOURCES.intake };
      row.consentId = randomUUID();
      const list: Array<NewConsent> = [{ ...base, id: row.consentId, consentType: CONSENT_TYPES.applicationForm, version: CONSENT_VERSIONS.applicationForm }];
      if (row.email && rng() < 0.6) list.push({ ...base, id: randomUUID(), consentType: CONSENT_TYPES.emailMarketing, version: CONSENT_VERSIONS.emailMarketing });
      if (rng() < 0.4) list.push({ ...base, id: randomUUID(), consentType: CONSENT_TYPES.smsMarketing, version: CONSENT_VERSIONS.smsMarketing });
      return list;
    });
    await tx.insert(consents).values(consentRows);
    await tx.insert(candidates).values(people.map((p) => p.row));

    // Employment episodes drive retention analytics; dismissals mirror the
    // dismiss flow in candidates.service.
    const clients = people.filter(({ row }) => row.kind === 'client');
    await tx.insert(employmentPeriods).values(
      clients.flatMap(({ row, previousEpisode }) => {
        const current = {
          candidateId: row.id, employedAt: row.workStartDate!, dismissedAt: row.workEndDate ?? null,
          dismissedReason: row.workEndReason ?? null, housingType: row.housingType ?? null,
          projectId: row.projectId ?? null, coordinatorId: row.coordinatorId ?? null, createdBy: adminId,
        };
        const prev = previousEpisode && { ...current, employedAt: previousEpisode.from, dismissedAt: previousEpisode.to, dismissedReason: previousEpisode.reason };
        return prev ? [prev, current] : [current];
      }),
    );
    const dismissed = people.filter(({ row }) => row.status === 'dismissed');
    if (dismissed.length) {
      await tx.insert(dismissals).values(
        dismissed.map(({ row }) => ({
          candidateId: row.id, dismissedAt: row.workEndDate!, reason: row.workEndReason!,
          reasonCode: row.workEndReason!, recordedById: row.coordinatorId ?? adminId, createdAt: row.workEndDate!,
        })),
      );
    }

    await tx.insert(candidateComments).values(
      people.filter(() => rng() < 0.35).map(({ row }) => ({
        candidateId: row.id, authorId: row.recruiterId ?? adminId, body: pick(rng, COMMENTS),
        createdAt: new Date(Math.min(row.createdAt.getTime() + between(rng, 1, 20) * DAY, now.getTime())),
      })),
    );

    const taskStatuses = ['new', 'new', 'in_work', 'completed', 'cancelled'] as const;
    await tx.insert(tasks).values(
      Array.from({ length: 22 }, (_, i) => {
        const status = taskStatuses[i % taskStatuses.length]!;
        const subject = people[between(rng, 0, people.length - 1)]!.row;
        return {
          candidateId: i % 4 === 3 ? null : subject.id,
          assigneeId: pick(rng, [...recruiters, ...coordinators]),
          type: 'other', title: pick(rng, TASKS), status, createdById: adminId,
          // A few overdue open tasks, so the "My tasks" widget has something to flag.
          dueAt: new Date(now.getTime() + between(rng, -5, 10) * DAY),
          doneAt: status === 'completed' ? ago(between(rng, 0, 5)) : null,
          createdAt: ago(between(rng, 6, 30)),
        };
      }),
    );

    await tx.insert(employerInquiries).values(
      INQUIRIES.map((q, i) => ({
        ...q, privacyAccepted: true, assignedToId: q.status === 'new' ? null : adminId,
        contactedAt: q.status === 'new' ? null : ago(i + 1), createdAt: ago(i * 3 + 2),
      })),
    );

    const templateRows = await tx
      .insert(messageTemplates)
      .values(TEMPLATES.map((t) => ({ ...t, createdById: adminId })))
      .returning({ id: messageTemplates.id, channel: messageTemplates.channel, subject: messageTemplates.subject, body: messageTemplates.body });
    const withEmail = people.filter(({ row }) => row.email).slice(0, 24);
    await tx.insert(messages).values(
      withEmail.map(({ row }, i) => {
        const t = templateRows[i % templateRows.length]!;
        const sentAt = ago(between(rng, 1, 25));
        const status = pick(rng, ['delivered', 'delivered', 'opened', 'sent'] as const);
        return {
          candidateId: row.id, channel: t.channel, templateId: t.id, subject: t.subject,
          body: t.body.replace(/\{\{firstName\}\}/g, row.name.split(' ')[0]!), status,
          externalId: `demo-${i}`, sentById: row.recruiterId ?? adminId, sentAt,
          deliveredAt: status === 'sent' ? null : sentAt, openedAt: status === 'opened' ? sentAt : null,
        };
      }),
    );

    await tx.insert(documents).values(
      DOCUMENTS.map((d) => ({ ...d, createdBy: adminId, publishedAt: ago(30) })),
    );

    return { skipped: false, users: staff.length, candidates: people.length };
  });
}
