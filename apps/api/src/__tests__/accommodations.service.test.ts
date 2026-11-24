import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/analytics.repo', () => ({
  housingCandidates: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as analyticsRepo from '../repositories/analytics.repo';
import { housingSummarySchema } from '@opushr/shared';

beforeEach(() => vi.clearAllMocks());

type HousingRow = Awaited<ReturnType<typeof analyticsRepo.housingCandidates>>[number];

function row(overrides: Partial<HousingRow> = {}): HousingRow {
  return {
    id: 'cand-1',
    name: 'Anna Kowalska',
    status: 'employed',
    housingType: 'our',
    updatedAt: new Date('2024-05-01T10:00:00.000Z'),
    ...overrides,
  } as HousingRow;
}

describe('accommodations.service.getHousingSummary', () => {
  it('groups rows by housingType (our vs own)', async () => {
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([
      row({ id: 'c-our-1', name: 'A Our1', housingType: 'our' }),
      row({ id: 'c-our-2', name: 'B Our2', housingType: 'our', status: 'employed' }),
      row({ id: 'c-own-1', name: 'C Own1', housingType: 'own', status: 'employed' }),
    ]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    expect(result.ourHousing.count).toBe(2);
    expect(result.ourHousing.candidates.map((c) => c.id)).toEqual(['c-our-1', 'c-our-2']);
    expect(result.ownHousing.count).toBe(1);
    expect(result.ownHousing.candidates.map((c) => c.id)).toEqual(['c-own-1']);
  });

  it('returns 0 counts and empty arrays when there are no housed candidates', async () => {
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    expect(result.ourHousing.count).toBe(0);
    expect(result.ourHousing.candidates).toEqual([]);
    expect(result.ownHousing.count).toBe(0);
    expect(result.ownHousing.candidates).toEqual([]);
  });

  it('skips rows where housingType is null/empty (defensive)', async () => {
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([
      row({ id: 'c-1', housingType: 'our' }),
      row({ id: 'c-2', housingType: '' }), // defensive: should be filtered
      row({ id: 'c-3', housingType: 'unknown' as never }), // anything not 'our'/'own'
      row({ id: 'c-4', housingType: 'own', status: 'employed' }),
    ]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    expect(result.ourHousing.count).toBe(1);
    expect(result.ourHousing.candidates[0]?.id).toBe('c-1');
    expect(result.ownHousing.count).toBe(1);
    expect(result.ownHousing.candidates[0]?.id).toBe('c-4');
  });

  it('count matches candidates.length per group', async () => {
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([
      row({ id: 'a', housingType: 'our' }),
      row({ id: 'b', housingType: 'our', status: 'employed' }),
      row({ id: 'c', housingType: 'our', status: 're_employed' }),
      row({ id: 'd', housingType: 'own', status: 'employed' }),
      row({ id: 'e', housingType: 'own', status: 'employed' }),
    ]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    expect(result.ourHousing.count).toBe(result.ourHousing.candidates.length);
    expect(result.ownHousing.count).toBe(result.ownHousing.candidates.length);
    expect(result.ourHousing.count).toBe(3);
    expect(result.ownHousing.count).toBe(2);
  });

  it('returned shape passes the HousingSummary Zod schema', async () => {
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([
      row({ id: '11111111-1111-1111-1111-111111111111', housingType: 'our', status: 'employed' }),
      row({ id: '22222222-2222-2222-2222-222222222222', housingType: 'own', status: 'employed' }),
    ]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    const parsed = housingSummarySchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('serializes updatedAt as ISO string', async () => {
    const ts = new Date('2024-06-15T08:30:00.000Z');
    vi.mocked(analyticsRepo.housingCandidates).mockResolvedValue([
      row({ id: 'c-1', housingType: 'our', updatedAt: ts }),
    ]);
    const { getHousingSummary } = await import('../services/accommodations.service');
    const result = await getHousingSummary({ id: 'admin-1', role: 'admin' });

    expect(result.ourHousing.candidates[0]?.updatedAt).toBe(ts.toISOString());
  });
});
