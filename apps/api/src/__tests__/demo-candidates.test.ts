import { describe, expect, it } from 'vitest';
import { buildCandidates, createRng, STATUS_COUNTS } from '../demo/candidates';

const staff = { recruiters: ['r1', 'r2'], coordinators: ['c1'] };
const projects = ['p1', 'p2', 'p3'];
const now = new Date('2026-11-24T12:00:00Z');
const build = () => buildCandidates(createRng(42), staff, projects, now);

describe('demo candidate generator', () => {
  it('is deterministic for a given seed (apart from row ids)', () => {
    const strip = (xs: ReturnType<typeof build>) => xs.map(({ row }) => ({ ...row, id: '' }));
    expect(strip(build())).toEqual(strip(build()));
  });

  it('produces exactly the configured status funnel', () => {
    const counts = new Map<string, number>();
    for (const { row } of build()) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual(Object.fromEntries(STATUS_COUNTS));
  });

  it('uses only obviously fake contact data', () => {
    for (const { row } of build()) {
      if (row.email) expect(row.email).toMatch(/@example\.com$/);
      expect(row.phone).toMatch(/^\+48 555 \d{3} \d{3}$/);
    }
  });

  it('keeps employment timelines consistent and in the past', () => {
    for (const { row, previousEpisode } of build()) {
      const isClient = ['employed', 're_employed', 'dismissed'].includes(row.status);
      expect(row.kind).toBe(isClient ? 'client' : 'candidate');
      if (!isClient) {
        expect(row.workStartDate).toBeUndefined();
        continue;
      }
      const start = row.workStartDate as Date;
      expect(start.getTime()).toBeGreaterThan(row.createdAt.getTime());
      expect(start.getTime()).toBeLessThan(now.getTime());
      if (row.status === 'dismissed') {
        expect((row.workEndDate as Date).getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(row.workEndReason).toBeTruthy();
      }
      if (row.status === 're_employed') {
        expect(previousEpisode).toBeDefined();
        expect(previousEpisode!.to.getTime()).toBeLessThan(start.getTime());
      }
    }
  });
});
