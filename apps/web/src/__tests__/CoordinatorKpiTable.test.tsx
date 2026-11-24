// @vitest-environment jsdom
/**
 * CoordinatorKpiTable.test.tsx — KPI table for coordinators in the analytics
 * dashboard.
 *
 * Behavior (post-2026-06-16 refactor — option B, mirrors RecruiterKpiTable):
 * - Row is no longer clickable; each row exposes two explicit buttons.
 * - "Users" button → /candidates?coordinatorId={id} (full filtered list)
 * - "Stats" button → /analytics/users/{userId} (per-user drill-down)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoordinatorKpiItem } from '@opushr/shared';
import { renderWithProviders, screen, userEvent } from './test-utils';

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { CoordinatorKpiTable } from '../features/dashboard/CoordinatorKpiTable';

const sampleRows: CoordinatorKpiItem[] = [
  {
    userId: 'coord-1',
    fullName: 'Bartek Nowak',
    isFreelancer: false,
    candidatesCoordinated: 12,
    currentlyHoused: 7,
    housingUtilizationPercent: 7 / 12,
    avgTenureDays: 42.5,
    totalTenureDays: 510,
    dismissalsThisMonth: 2,
    // 2026-07-10 — unified six-metric workforce block (episode coordinator).
    workforce: {
      employedInPeriod: 10,
      workingCount: 8,
      dismissedCount: 2,
      avgDaysFinished: 21.5,
      avgDaysWorking: 42.5,
      totalDaysInPeriod: 510,
      avgDaysFinishedCnt: 2,
      avgDaysWorkingCnt: 8,
      avgDaysAll: 38.3,
      avgDaysAllCnt: 10,
      retentionRate: 0.8,
    },
  },
  {
    userId: 'coord-2',
    fullName: 'Olena Shevchenko',
    isFreelancer: false,
    candidatesCoordinated: 0,
    currentlyHoused: 0,
    housingUtilizationPercent: 0,
    avgTenureDays: null,
    totalTenureDays: null,
    dismissalsThisMonth: 0,
    workforce: {
      employedInPeriod: 0,
      workingCount: 0,
      dismissedCount: 0,
      avgDaysFinished: null,
      avgDaysWorking: null,
      totalDaysInPeriod: 0,
      avgDaysFinishedCnt: 0,
      avgDaysWorkingCnt: 0,
      avgDaysAll: null,
      avgDaysAllCnt: 0,
      retentionRate: 0,
    },
  },
];

describe('CoordinatorKpiTable', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('renders one row per coordinator', () => {
    renderWithProviders(<CoordinatorKpiTable coordinators={sampleRows} />);
    expect(screen.getByText('Bartek Nowak')).toBeTruthy();
    expect(screen.getByText('Olena Shevchenko')).toBeTruthy();
  });

  it('renders the empty state when no coordinators provided', () => {
    renderWithProviders(<CoordinatorKpiTable coordinators={[]} />);
    // i18n stub returns the raw key for missing translations.
    expect(screen.getByText('coordinatorKpi.empty')).toBeTruthy();
  });

  it('renders the six-metric workforce block (total days + retention %)', () => {
    renderWithProviders(<CoordinatorKpiTable coordinators={sampleRows} />);
    expect(screen.getByText(/510/)).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('sorting: clicking «Працюють» header sorts descending by workingCount', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CoordinatorKpiTable
        coordinators={[
          { ...sampleRows[1]!, fullName: 'Zero First' },
          sampleRows[0]!,
        ]}
      />,
    );
    // Default order: as provided (Zero First on top).
    let rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.findIndex((x) => x.includes('Zero First'))).toBeLessThan(
      rows.findIndex((x) => x.includes('Bartek Nowak')),
    );
    await user.click(screen.getByRole('button', { name: 'sort:retention.working' }));
    rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    // Descending: Bartek (8 working) above Zero First (0).
    expect(rows.findIndex((x) => x.includes('Bartek Nowak'))).toBeLessThan(
      rows.findIndex((x) => x.includes('Zero First')),
    );
  });

  it('Clients button navigates to /clients?coordinatorId=...', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CoordinatorKpiTable coordinators={sampleRows} />);
    const usersButtons = screen.getAllByRole('button', {
      name: /coordinatorKpi\.showPeopleBtn/,
    });
    expect(usersButtons.length).toBe(sampleRows.length);
    await user.click(usersButtons[0]!);
    expect(navigateMock).toHaveBeenCalledWith('/clients?coordinatorId=coord-1');
  });

  it('Stats button navigates to /analytics/users/:id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CoordinatorKpiTable coordinators={sampleRows} />);
    const statsButtons = screen.getAllByRole('button', {
      name: /coordinatorKpi\.showStatsBtn/,
    });
    expect(statsButtons.length).toBe(sampleRows.length);
    await user.click(statsButtons[0]!);
    expect(navigateMock).toHaveBeenCalledWith('/analytics/users/coord-1');
  });

  it('clicking the row body does not navigate (only buttons trigger nav)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CoordinatorKpiTable coordinators={sampleRows} />);
    await user.click(screen.getByText('Bartek Nowak'));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
