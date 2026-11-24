// @vitest-environment jsdom
/**
 * AccommodationListPage.test.tsx — covers the housing summary page.
 *
 * Strategy:
 * - Mock `useHousingSummary` to feed different states (loading / populated /
 *   empty groups).
 * - Mock `useNavigate` so we can assert row clicks navigate to the candidate
 *   detail route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HousingSummary } from '@opushr/shared';
import { renderWithProviders, screen, userEvent, within } from './test-utils';

const { useHousingSummaryMock, navigateMock } = vi.hoisted(() => ({
  useHousingSummaryMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../features/accommodations/api', () => ({
  useHousingSummary: useHousingSummaryMock,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { AccommodationListPage } from '../features/accommodations/AccommodationListPage';

const sampleSummary: HousingSummary = {
  ourHousing: {
    count: 2,
    candidates: [
      {
        id: 'c1',
        name: 'Kowalska Anna',
        status: 'employed',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
      {
        id: 'c2',
        name: 'Nowak Bartek',
        status: 'employed',
        updatedAt: '2026-05-02T10:00:00.000Z',
      },
    ],
  },
  ownHousing: {
    count: 1,
    candidates: [
      {
        id: 'c3',
        name: 'Shevchenko Olena',
        status: 're_employed',
        updatedAt: '2026-05-03T10:00:00.000Z',
      },
    ],
  },
};

describe('AccommodationListPage', () => {
  beforeEach(() => {
    useHousingSummaryMock.mockReset();
    navigateMock.mockReset();
  });

  it('shows a loader while the summary is pending', () => {
    useHousingSummaryMock.mockReturnValue({ data: undefined, isPending: true });
    const { container } = renderWithProviders(<AccommodationListPage />);
    // Mantine <Loader/> renders an element with role="presentation" + svg.
    // Easier to assert by class added by Mantine to indicate loader.
    expect(container.querySelector('.mantine-Loader-root')).not.toBeNull();
  });

  it('renders both KPI tiles with the group counts', () => {
    useHousingSummaryMock.mockReturnValue({ data: sampleSummary, isPending: false });
    renderWithProviders(<AccommodationListPage />);

    // Counts are rendered as the big <Title order={1}> in each tile.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    // Both group labels should appear (label key returned literally by stub i18n).
    const ourLabels = screen.getAllByText('housing.ourHousing');
    expect(ourLabels.length).toBeGreaterThan(0);
    const ownLabels = screen.getAllByText('housing.ownHousing');
    expect(ownLabels.length).toBeGreaterThan(0);
  });

  it('renders the active group table; switching tiles shows the other group', async () => {
    useHousingSummaryMock.mockReturnValue({ data: sampleSummary, isPending: false });
    const user = userEvent.setup();
    renderWithProviders(<AccommodationListPage />);

    // Default active group is "our" — both our-housing candidates visible.
    expect(screen.getByText('Kowalska Anna')).toBeTruthy();
    expect(screen.getByText('Nowak Bartek')).toBeTruthy();
    expect(screen.queryByText('Shevchenko Olena')).toBeNull();

    // Click the "own" tile (label appears as the i18n key in stubbed env).
    const ownTiles = screen.getAllByText('housing.ownHousing');
    // First match is the tile button; click it.
    await user.click(ownTiles[0]!);

    // Now own-housing candidate is rendered, our-housing ones gone.
    expect(screen.getByText('Shevchenko Olena')).toBeTruthy();
    expect(screen.queryByText('Kowalska Anna')).toBeNull();
  });

  it('shows the empty-state message when the active group has no candidates', () => {
    useHousingSummaryMock.mockReturnValue({
      data: {
        ourHousing: { count: 0, candidates: [] },
        ownHousing: { count: 0, candidates: [] },
      } satisfies HousingSummary,
      isPending: false,
    });
    renderWithProviders(<AccommodationListPage />);

    // Only the active group renders a table, so the empty message appears once.
    const emptyMessages = screen.getAllByText('housing.empty');
    expect(emptyMessages.length).toBe(1);
  });

  it('clicking a candidate row navigates to /candidates/:id', async () => {
    useHousingSummaryMock.mockReturnValue({ data: sampleSummary, isPending: false });
    const user = userEvent.setup();
    renderWithProviders(<AccommodationListPage />);

    // Locate the <tr> that wraps "Kowalska Anna" and click it.
    const row = screen.getByText('Kowalska Anna').closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row!).getByText('Kowalska Anna'));

    expect(navigateMock).toHaveBeenCalledWith('/candidates/c1');
  });
});
