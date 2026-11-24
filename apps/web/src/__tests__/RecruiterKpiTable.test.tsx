// @vitest-environment jsdom
/**
 * RecruiterKpiTable.test.tsx — KPI table for staff recruiters + freelancers
 * in the analytics dashboard.
 *
 * Behavior (post-2026-06-16 refactor — option B):
 * - Row is no longer clickable; each row exposes two explicit buttons.
 * - "Users" button → navigate to /candidates?recruiterId={id} (full list)
 *   or /candidates?freelancerId={id} for freelancer rows.
 * - "Stats" button → navigate to /analytics/users/{userId}; only rendered
 *   for staff rows that have a real users.id (freelancer rows skip it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecruiterKpiItem, FreelancerKpiItem } from '@crm/shared';
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

import { RecruiterKpiTable } from '../features/dashboard/RecruiterKpiTable';

const recruiters: RecruiterKpiItem[] = [
  {
    userId: 'rec-1',
    fullName: 'Anna Kowalska',
    isFreelancer: false,
    candidatesOwned: 18,
    arrivedCount: 12,
    arrivedPercent: 12 / 18,
    employedCount: 9,
    employedPercent: 0.5,
    avgTenureDays: 67.3,
    totalTenureDays: 605.7,
    sourceBreakdown: { facebook: 5, referral: 4 },
    conversionsThisMonth: 2,
    dismissalsThisMonth: 1,
    recruitedInPeriod: 7,
    employedInPeriod: 3,
    dismissedInPeriod: 1,
    // 2026-07-10 — unified six-metric workforce block.
    workforce: {
      employedInPeriod: 12,
      workingCount: 9,
      dismissedCount: 3,
      avgDaysFinished: 20.5,
      avgDaysWorking: 67.3,
      totalDaysInPeriod: 605.7,
      avgDaysFinishedCnt: 3,
      avgDaysWorkingCnt: 9,
      avgDaysAll: 55.6,
      avgDaysAllCnt: 12,
      retentionRate: 0.75,
    },
  },
];

const freelancers: FreelancerKpiItem[] = [
  {
    freelancerId: 'free-1',
    fullName: 'Marek Wiśniewski',
    candidatesOwned: 4,
    arrivedCount: 3,
    arrivedPercent: 0.75,
    workingNow: 2,
    employedCount: 2,
    employedPercent: 0.5,
    avgTenureDays: null,
    totalTenureDays: null,
    sourceBreakdown: {},
    dismissalsThisMonth: 0,
    commissionRate: 10,
  },
];

describe('RecruiterKpiTable', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('renders one row per recruiter and freelancer', () => {
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    expect(screen.getByText('Anna Kowalska')).toBeTruthy();
    expect(screen.getByText('Marek Wiśniewski')).toBeTruthy();
  });

  it('renders the six-metric workforce block; freelancer-table row shows dashes', () => {
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    // totalDaysInPeriod rounded to int days + colored retention percent.
    expect(screen.getByText(/606/)).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    // External freelancer row has no workforce source → all six cells are '—'.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(7);
  });

  it('sorting: clicking «Працюють» puts the recruiter with data above the null freelancer row', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    await user.click(screen.getByRole('button', { name: 'sort:retention.working' }));
    let rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.findIndex((x) => x.includes('Anna Kowalska'))).toBeLessThan(
      rows.findIndex((x) => x.includes('Marek Wiśniewski')),
    );
    // Ascending keeps null rows LAST (a freelancer without data never tops the list).
    await user.click(screen.getByRole('button', { name: 'sort:retention.working' }));
    rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.findIndex((x) => x.includes('Anna Kowalska'))).toBeLessThan(
      rows.findIndex((x) => x.includes('Marek Wiśniewski')),
    );
  });

  it('Clients button on recruiter row navigates to /clients?recruiterId=...', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    const usersButtons = screen.getAllByRole('button', { name: /recruiterKpi\.showPeopleBtn/ });
    await user.click(usersButtons[0]!);
    expect(navigateMock).toHaveBeenCalledWith('/clients?recruiterId=rec-1');
  });

  it('Clients button on freelancer row navigates to /clients?freelancerId=...', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    const usersButtons = screen.getAllByRole('button', { name: /recruiterKpi\.showPeopleBtn/ });
    // Order: recruiters first, then freelancers.
    await user.click(usersButtons[1]!);
    expect(navigateMock).toHaveBeenCalledWith('/clients?freelancerId=free-1');
  });

  it('Stats button on recruiter row navigates to /analytics/users/:id', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    const statsButtons = screen.getAllByRole('button', { name: /recruiterKpi\.showStatsBtn/ });
    // One per recruiter row + one per freelancer-only row.
    expect(statsButtons.length).toBe(2);
    await user.click(statsButtons[0]!);
    expect(navigateMock).toHaveBeenCalledWith('/analytics/users/rec-1');
  });

  it('freelancer-only row Stats button navigates to /analytics/freelancers/:id', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    const statsButtons = screen.getAllByRole('button', { name: /recruiterKpi\.showStatsBtn/ });
    // Order: recruiters first, then freelancer-only entries.
    await user.click(statsButtons[1]!);
    expect(navigateMock).toHaveBeenCalledWith('/analytics/freelancers/free-1');
  });

  it('clicking the row body does not navigate (only buttons trigger nav)', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecruiterKpiTable recruiters={recruiters} freelancers={freelancers} />,
    );
    await user.click(screen.getByText('Anna Kowalska'));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
