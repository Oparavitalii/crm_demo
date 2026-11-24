import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { projects, type Project, type NewProject } from '../db/tables/projects';
import { candidates } from '../db/tables/candidates';
import type { ListProjectsQuery } from '@crm/shared';

// `foundCount` = candidates assigned to a project, EXCLUDING cancelled,
// blacklist and anonymized rows. Dismissed candidates ARE counted because the
// project staffed them historically. See docs/Engineering_Rules.md.
export interface ProjectMetrics {
  foundCount: number;
  missingCount: number;
  percentFilled: number;
}
export type ProjectWithMetrics = Project & ProjectMetrics;

export async function list(
  query: ListProjectsQuery,
  scope: { recruiterId?: string; coordinatorId?: string } = {},
): Promise<{ items: ProjectWithMetrics[]; total: number }> {
  const where: SQL[] = [];
  if (query.isActive !== undefined) where.push(eq(projects.isActive, query.isActive));
  if (query.q) where.push(ilike(projects.name, `%${query.q}%`));

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  // Dynamic sort: pick the column + direction from query. For startDate we
  // append NULLS LAST so projects without a known start date sink to the
  // bottom regardless of direction (otherwise NULLS show up at the top under
  // ASC, which the UI consistently shows as "no date / unknown").
  const dir = query.sortDir === 'asc' ? asc : desc;
  const orderBy = (() => {
    if (query.sortBy === 'startDate') {
      return query.sortDir === 'asc'
        ? [sql`${projects.startDate} asc nulls last`]
        : [sql`${projects.startDate} desc nulls last`];
    }
    if (query.sortBy === 'createdAt') return [dir(projects.createdAt)];
    return [dir(projects.name)];
  })();

  const [items, totalRow, founds] = await Promise.all([
    db.query.projects.findMany({
      where: condition,
      orderBy,
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(projects).where(condition).then((r) => r[0]),
    // Staffing baseline: only count candidates whose updated_at is on/after
    // the project's headcount_reset_at, so resets restart the progress bar.
    // 2026-06-13 — foundCount is per-user scoped. A recruiter sees how many
    // of THEIR candidates filled each project; a coordinator sees how many of
    // THEIR clients. Admin sees the global count. percentFilled/missingCount
    // are derived from foundCount downstream so they reflect the same scope.
    (() => {
      const candidateWhere: SQL[] = [
        isNotNull(candidates.projectId),
        isNull(candidates.anonymizedAt),
        sql`${candidates.status} NOT IN ('cancelled', 'blacklist')`,
        gte(candidates.updatedAt, projects.headcountResetAt),
      ];
      if (scope.recruiterId) {
        candidateWhere.push(eq(candidates.recruiterId, scope.recruiterId));
      }
      if (scope.coordinatorId) {
        candidateWhere.push(eq(candidates.coordinatorId, scope.coordinatorId));
      }
      return db
        .select({ projectId: candidates.projectId, cnt: count() })
        .from(candidates)
        .innerJoin(projects, eq(projects.id, candidates.projectId))
        .where(and(...candidateWhere))
        .groupBy(candidates.projectId);
    })(),
  ]);

  const foundMap = new Map<string, number>(
    founds
      .filter((r): r is { projectId: string; cnt: number } => r.projectId !== null)
      .map((r) => [r.projectId, r.cnt]),
  );

  const enriched: ProjectWithMetrics[] = items.map((p) => {
    const foundCount = foundMap.get(p.id) ?? 0;
    return {
      ...p,
      foundCount,
      missingCount: Math.max(0, p.headcountNeeded - foundCount),
      percentFilled:
        p.headcountNeeded === 0 ? 0 : Math.min(1, foundCount / p.headcountNeeded),
    };
  });

  return { items: enriched, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export async function findByName(name: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.name, name) });
}

export async function insert(input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  if (!row) throw new Error('Failed to insert project');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewProject>,
): Promise<Project | undefined> {
  const [row] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(projects).where(eq(projects.id, id));
  return (result.rowCount ?? 0) > 0;
}
