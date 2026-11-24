import { randomUUID } from 'node:crypto';
import type { CandidateStatus } from '@crm/shared';
import type { NewCandidate } from '../db/tables/candidates';
import {
  BLACKLIST_NOTES, CANCEL_NOTES, DISMISSAL_REASONS, EXPERIENCE, LEGAL_STATUSES,
  NAMES, NOTES, POSITIONS, SOURCES, UA_NATIONALITIES,
} from './fixtures';

const DAY = 24 * 60 * 60 * 1000;

// Deterministic PRNG (mulberry32): the demo looks the same after every reset,
// while dates stay relative to "now" so the dashboard always shows recent data.
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;
export const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
function weighted<T>(rng: Rng, dist: ReadonlyArray<[T, number]>): T {
  let r = rng() * dist.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of dist) if ((r -= w) <= 0) return v;
  return dist[dist.length - 1]![0];
}

// Exact counts, not weights, so the funnel on the dashboard is stable.
export const STATUS_COUNTS: ReadonlyArray<[CandidateStatus, number]> = [
  ['new', 28], ['in_progress', 24], ['documents_submitted', 16], ['cancelled', 12],
  ['employed', 36], ['re_employed', 6], ['dismissed', 14], ['blacklist', 4],
];

const ASCII: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const slug = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ASCII[c] ?? c).replace(/[^a-z]/g, '');

function retentionBucket(days: number): string {
  if (days < 30) return 'under_month';
  if (days < 60) return 'month_plus';
  if (days < 90) return 'two_months_plus';
  if (days < 180) return 'three_months_plus';
  if (days < 330) return 'six_months_plus';
  return 'eleven_months_plus';
}

export interface StaffIds {
  recruiters: string[];
  coordinators: string[];
}

export interface DemoCandidate {
  row: NewCandidate & { id: string; status: CandidateStatus; createdAt: Date };
  // Closed earlier episode for re-employed people (employment_periods history).
  previousEpisode?: { from: Date; to: Date; reason: string };
}

export function buildCandidates(rng: Rng, staff: StaffIds, projectIds: string[], now = new Date()): DemoCandidate[] {
  const statuses = STATUS_COUNTS.flatMap(([s, n]) => Array<CandidateStatus>(n).fill(s));
  const out: DemoCandidate[] = [];

  statuses.forEach((status, i) => {
    const isUa = rng() < 0.65;
    const female = rng() < 0.45;
    const first = isUa ? pick(rng, female ? NAMES.uaFemale : NAMES.uaMale) : pick(rng, female ? NAMES.plFemale : NAMES.plMale);
    const last = isUa ? pick(rng, NAMES.uaLast) : pick(rng, female ? NAMES.plLastFemale : NAMES.plLastMale);
    const isClient = status === 'employed' || status === 're_employed' || status === 'dismissed';
    const pastPipeline = status !== 'new';

    const [minAge, maxAge] = status === 're_employed' ? [130, 170] : isClient ? [40, 170] : [1, 75];
    const createdAt = new Date(now.getTime() - between(rng, minAge, maxAge) * DAY);
    const row: DemoCandidate['row'] = {
      id: randomUUID(),
      name: `${first} ${last}`,
      email: rng() < 0.75 ? `${slug(first)}.${slug(last)}.${i + 1}@example.com` : null,
      phone: `+48 555 ${String(100 + i).padStart(3, '0')} ${String(between(rng, 0, 999)).padStart(3, '0')}`,
      birthDate: new Date(now.getTime() - between(rng, 19, 58) * 365.25 * DAY).toISOString().slice(0, 10),
      nationality: isUa ? weighted(rng, UA_NATIONALITIES) : 'pl',
      legalStatus: isUa ? pick(rng, LEGAL_STATUSES) : null,
      position: pick(rng, POSITIONS),
      source: weighted(rng, SOURCES),
      status,
      kind: isClient ? 'client' : 'candidate',
      recruiterId: rng() < 0.9 ? pick(rng, staff.recruiters) : null,
      projectId: pastPipeline ? pick(rng, projectIds) : rng() < 0.3 ? pick(rng, projectIds) : null,
      messenger: rng() < 0.4 ? `TG: @${slug(first)}${i + 1}` : null,
      experience: rng() < 0.5 ? pick(rng, EXPERIENCE) : null,
      notes: rng() < 0.3 ? pick(rng, NOTES) : null,
      createdAt,
      updatedAt: createdAt,
    };

    if (['documents_submitted', 'employed', 're_employed', 'dismissed'].includes(status)) {
      row.documentsSubmittedAt = new Date(Math.min(createdAt.getTime() + between(rng, 2, 8) * DAY, now.getTime()));
    }
    let previousEpisode: DemoCandidate['previousEpisode'];
    if (isClient) {
      // Re-employed: a first, closed episode, then a gap, then the current one.
      if (status === 're_employed') {
        const from = new Date(createdAt.getTime() + 5 * DAY);
        const to = new Date(from.getTime() + between(rng, 30, 50) * DAY);
        previousEpisode = { from, to, reason: 'contract_ended' };
      }
      const start = previousEpisode
        ? new Date(previousEpisode.to.getTime() + between(rng, 10, 20) * DAY)
        : new Date(createdAt.getTime() + between(rng, 10, 25) * DAY);
      row.workStartDate = start;
      row.arrivedAt = new Date(start.getTime() - DAY);
      row.coordinatorId = pick(rng, staff.coordinators);
      row.housingType = status === 'dismissed' ? null : rng() < 0.6 ? 'our' : 'own';
      if (status === 'dismissed') {
        const end = new Date(Math.min(start.getTime() + between(rng, 7, 90) * DAY, now.getTime() - DAY));
        row.workEndDate = end;
        row.workEndReason = pick(rng, DISMISSAL_REASONS);
        row.retention = retentionBucket((end.getTime() - start.getTime()) / DAY);
        row.updatedAt = end;
      } else {
        row.retention = retentionBucket((now.getTime() - start.getTime()) / DAY);
        row.updatedAt = start;
      }
    }
    if (status === 'cancelled') row.reasonNote = pick(rng, CANCEL_NOTES);
    if (status === 'blacklist') row.reasonNote = pick(rng, BLACKLIST_NOTES);

    out.push({ row, previousEpisode });
  });
  return out;
}
