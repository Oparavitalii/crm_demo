// @vitest-environment jsdom
/**
 * UserStatsPage.test.tsx — per-user analytics drill-down.
 *
 * Strategy mirrors AccommodationListPage.test.tsx:
 * - Mock `useUserStats` to feed loading / populated / error states.
 * - Mock `useNavigate` so we can assert navigation on row clicks.
 * - Different content paths for recruiter (sourceBreakdown) vs coordinator
 *   (housingUtilization) are exercised in separate tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfileStats } from '@crm/shared';
import { renderWithProviders, screen } from './test-utils';

const { useUserStatsMock, navigateMock } = vi.hoisted(() => ({
  useUserStatsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../features/admin-users/api', () => ({
  useUserStats: useUserStatsMock,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ userId: 'rec-target' }),
  };
});

import { UserStatsPage } from '../features/admin-users/UserStatsPage';

const recruiterStats: UserProfileStats = {
  user: {
    id: 'rec-target',
    firstName: 'Anna',
    lastName: 'Kowalska',
    role: 'recruiter',
    email: 'anna@crm.test',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  funnel: {
    new: 3,
    in_progress: 1,
    documents_submitted: 0,
    cancelled: 0,
    employed: 2,
    re_employed: 0,
    dismissed: 1,
    blacklist: 0,
    total: 7,
  },
  retention: { totalEverEmployed: 3, currentlyEmployed: 2, rate: 2 / 3 },
  sourceBreakdown: { facebook: 4, unknown: 2 },
  avgTimeToHireDays: 12.5,
  recentCandidates: [
    {
      id: 'c-1',
      name: 'Jan Kowalski',
      status: 'employed',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  dismissalReasons: { employee_resigned: 1 },
};

const coordinatorStats: UserProfileStats = {
  ...recruiterStats,
  user: { ...recruiterStats.user, id: 'coord-target', role: 'coordinator' },
  sourceBreakdown: undefined,
  housingUtilization: { totalHoused: 5, currentlyEmployed: 3, rate: 0.6 },
};

describe('UserStatsPage', () => {
  beforeEach(() => {
    useUserStatsMock.mockReset();
    navigateMock.mockReset();
  });

  it('renders the loading skeleton while pending', () => {
    useUserStatsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    });
    const { container } = renderWithProviders(<UserStatsPage />);
    // Mantine <Skeleton/> emits a div with class mantine-Skeleton-root.
    expect(container.querySelector('.mantine-Skeleton-root')).not.toBeNull();
  });

  it('renders an error alert when the query fails', () => {
    useUserStatsMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { data: { error: 'FORBIDDEN' } },
    });
    renderWithProviders(<UserStatsPage />);
    // Error mapped via t() to users.errors.forbidden — in stubbed i18n it
    // surfaces as the literal key.
    expect(screen.getByText('users.errors.forbidden')).toBeTruthy();
  });

  it('renders recruiter KPI tiles and source breakdown', () => {
    useUserStatsMock.mockReturnValue({
      data: recruiterStats,
      isPending: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<UserStatsPage />);

    // Recruiter user name in header
    expect(screen.getByText(/Kowalska/)).toBeTruthy();
    // Recruiter-shaped KPI label keys
    expect(screen.getAllByText('userStats.totalCandidates').length).toBeGreaterThan(0);
    expect(screen.getAllByText('userStats.retentionRate').length).toBeGreaterThan(0);
    // No coordinator-only label
    expect(screen.queryByText('userStats.housingUtilization')).toBeNull();
    // Dismissal reasons table shows the canonical reason code
    expect(screen.getByText('employee_resigned')).toBeTruthy();
  });

  it('renders coordinator KPI tiles and housing card, hides source breakdown', () => {
    useUserStatsMock.mockReturnValue({
      data: coordinatorStats,
      isPending: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<UserStatsPage />);

    // Coordinator-shaped KPI label keys
    expect(screen.getAllByText('userStats.totalHoused').length).toBeGreaterThan(0);
    expect(screen.getAllByText('userStats.housingUtilization').length).toBeGreaterThan(0);
    // Coordinator hides recruiter-only retentionRate tile
    expect(screen.queryByText('userStats.retentionRate')).toBeNull();
  });

  it('renders empty dismissal reasons when none recorded', () => {
    useUserStatsMock.mockReturnValue({
      data: { ...recruiterStats, dismissalReasons: {} },
      isPending: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<UserStatsPage />);
    expect(screen.getByText('userStats.noDismissals')).toBeTruthy();
  });
});
