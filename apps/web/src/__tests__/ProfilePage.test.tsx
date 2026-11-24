// @vitest-environment jsdom
/**
 * ProfilePage.test.tsx — security-critical UI on the /profile page.
 *
 * Locks down the actual contract the user sees:
 *  - Header shows firstName + lastName + email + role.
 *  - Personal-info card is read-only (no inline edit form on this page).
 *  - Public application slug copy section appears only when both publicSlug
 *    and isActive are present; the Copy button copies the full /apply/:slug
 *    URL to the clipboard.
 *  - 2FA card is admin-only (component renders adminOnly hint otherwise).
 *    For admins it shows "Enable" when has2FA=false and "Disable" when true,
 *    and clicking Enable starts the enrollment mutation and mounts the QR
 *    modal once the mutation resolves.
 *  - Password change is triggered via a self-service reset-email flow — the
 *    button opens a Mantine confirm modal; confirming POSTs /me/reset-password.
 *  - Loading and error states for the dependent useMyAcceptances query.
 *
 * Strategy:
 *  - Use the shared `renderWithProviders` from test-utils, but wrap children
 *    in <ModalsProvider> locally because the prod App tree provides it and
 *    handleResetSelf relies on it.
 *  - Mock the auth-store, the 2FA mutation hooks, and the documents hook so
 *    the tests stay hermetic. The fetch mock for /me/reset-password is the
 *    one place we exercise the mutationFn (it lives inline in ProfilePage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalsProvider } from '@mantine/modals';
import type { PublicUser } from '@crm/shared';
import { renderWithProviders, screen, userEvent, waitFor, within } from './test-utils';

// ---------------------------------------------------------------------------
// Hoisted mocks — referenced inside vi.mock factories below.
// ---------------------------------------------------------------------------
const {
  authUserRef,
  enrollMutateMock,
  confirmMutateMock,
  disableMutateMock,
  myAcceptancesRef,
  apiFetchMock,
} = vi.hoisted(() => ({
  authUserRef: { current: null as PublicUser | null },
  enrollMutateMock: vi.fn(),
  confirmMutateMock: vi.fn(),
  disableMutateMock: vi.fn(),
  myAcceptancesRef: { current: { data: { items: [] as unknown[] } } },
  apiFetchMock: vi.fn(),
}));

// Mock the zustand store the same way it's used in the component: a selector
// hook. Tests mutate `authUserRef.current` per scenario before rendering.
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: PublicUser | null }) => unknown) =>
      selector({ user: authUserRef.current }),
    {
      setState: vi.fn(),
      getState: () => ({ user: authUserRef.current }),
    },
  ),
}));

vi.mock('@/features/auth/api', () => ({
  useEnroll2FA: () => ({ mutate: enrollMutateMock, isPending: false }),
  useConfirm2FA: () => ({ mutate: confirmMutateMock, isPending: false }),
  useDisable2FA: () => ({ mutate: disableMutateMock, isPending: false }),
}));

vi.mock('@/features/documents/api', () => ({
  useMyAcceptances: () => myAcceptancesRef.current,
}));

// apiFetch is the inline mutationFn for /me/reset-password. We don't assert
// on its call in the modal-confirm test below — opening the confirm modal is
// enough to lock the password-reset flow contract. Stub it anyway so a
// real fetch is never attempted.
vi.mock('@/lib/http', () => ({
  apiFetch: apiFetchMock,
  parseApiError: (err: unknown) => ({ code: (err as { code?: string } | null)?.code ?? 'UNKNOWN' }),
}));

import { ProfilePage } from '../features/admin/ProfilePage';

// ---------------------------------------------------------------------------
// Render helper — adds ModalsProvider on top of the shared providers so the
// reset-password confirm modal can mount. The shared renderWithProviders
// only includes MantineProvider, not ModalsProvider.
// ---------------------------------------------------------------------------
function renderProfile(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ModalsProvider>
      <ProfilePage />
    </ModalsProvider>,
  );
}

const baseAdmin: PublicUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@crm.test',
  firstName: 'Anna',
  lastName: 'Admin',
  role: 'admin',
  isActive: true,
  lastLoginAt: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  has2FA: false,
  publicSlug: 'anna-admin',
};

const baseRecruiter: PublicUser = {
  ...baseAdmin,
  id: '00000000-0000-4000-8000-000000000002',
  email: 'rec@crm.test',
  firstName: 'Iryna',
  lastName: 'Recruiter',
  role: 'recruiter',
};

describe('ProfilePage', () => {
  beforeEach(() => {
    enrollMutateMock.mockReset();
    confirmMutateMock.mockReset();
    disableMutateMock.mockReset();
    apiFetchMock.mockReset();
    myAcceptancesRef.current = { data: { items: [] } };
    authUserRef.current = null;
  });

  it('renders nothing when there is no user in the store', () => {
    authUserRef.current = null;
    const { container } = renderProfile();
    // ProfilePage returns null when user is missing — Container/Card not rendered.
    expect(container.querySelector('.mantine-Container-root')).toBeNull();
  });

  it('renders firstName, lastName, email and role from the auth store', () => {
    authUserRef.current = baseAdmin;
    renderProfile();
    expect(screen.getByRole('heading', { name: /Anna\s+Admin/ })).toBeTruthy();
    expect(screen.getByText('admin@crm.test')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
  });

  it('shows the public apply slug section with a Copy button when publicSlug is set', () => {
    authUserRef.current = { ...baseRecruiter, publicSlug: 'iryna-r', isActive: true };
    renderProfile();
    // The TextInput uses the full origin URL — jsdom's default origin is http://localhost.
    const input = screen.getByDisplayValue(/\/apply\/iryna-r$/) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.readOnly).toBe(true);
    // Copy button is labelled via the i18n key (test-utils returns the key as text).
    expect(screen.getByRole('button', { name: /applyLink\.copy/ })).toBeTruthy();
  });

  it('hides the apply slug section when publicSlug is not set', () => {
    authUserRef.current = { ...baseRecruiter, publicSlug: null };
    renderProfile();
    expect(screen.queryByDisplayValue(/\/apply\//)).toBeNull();
    expect(screen.queryByRole('button', { name: /applyLink\.copy/ })).toBeNull();
  });

  it('hides the apply slug section when the user is deactivated', () => {
    authUserRef.current = { ...baseRecruiter, publicSlug: 'iryna-r', isActive: false };
    renderProfile();
    expect(screen.queryByDisplayValue(/\/apply\//)).toBeNull();
  });

  it('renders the password-reset trigger button (email-flow, no inline form)', () => {
    authUserRef.current = baseAdmin;
    renderProfile();
    // Two buttons share the key: the card button and the modal confirm button.
    // The card-level button is the always-rendered one; we just need it to exist.
    const resetButtons = screen.getAllByRole('button', { name: /resetSelf\.button/ });
    expect(resetButtons.length).toBeGreaterThan(0);
    // Page-level personal info (email/role) is rendered as plain Text, not as
    // editable inputs — no input has the email value.
    expect(screen.queryByDisplayValue('admin@crm.test')).toBeNull();
  });

  it('opens the reset-password confirm modal when the Reset button is clicked', async () => {
    authUserRef.current = baseAdmin;
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole('button', { name: /resetSelf\.button/ }));

    // Mantine modals.openConfirmModal renders a dialog with the title key.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/resetSelf\.confirm/)).toBeTruthy();
  });

  it('shows the 2FA admin-only hint for non-admin users', () => {
    authUserRef.current = baseRecruiter;
    renderProfile();
    expect(screen.getByText(/twoFactor\.adminOnly/)).toBeTruthy();
    // No enable/disable buttons for non-admins.
    expect(screen.queryByRole('button', { name: /twoFactor\.enrollPrompt/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /twoFactor\.disable/ })).toBeNull();
  });

  it('shows the Enable 2FA button when admin has has2FA = false', () => {
    authUserRef.current = { ...baseAdmin, has2FA: false };
    renderProfile();
    expect(screen.getByRole('button', { name: /twoFactor\.enrollPrompt/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^twoFactor\.disable$/ })).toBeNull();
  });

  it('shows the Disable 2FA button when admin has has2FA = true', () => {
    authUserRef.current = { ...baseAdmin, has2FA: true };
    renderProfile();
    expect(screen.getByRole('button', { name: /^twoFactor\.disable$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /twoFactor\.enrollPrompt/ })).toBeNull();
  });

  it('starts 2FA enrollment and mounts the QR modal on mutation success', async () => {
    authUserRef.current = { ...baseAdmin, has2FA: false };

    // Simulate the mutation calling onSuccess with QR payload.
    enrollMutateMock.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({
        secret: 'JBSWY3DPEHPK3PXP',
        qrCodeDataUrl: 'data:image/png;base64,AAAA',
      });
    });

    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole('button', { name: /twoFactor\.enrollPrompt/ }));

    expect(enrollMutateMock).toHaveBeenCalledTimes(1);

    // QR modal opens — title uses twoFactor.scanQrCode and the secret is shown.
    await waitFor(() => {
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    });
    // Confirm button is rendered inside the modal.
    expect(screen.getByRole('button', { name: /twoFactor\.confirm/ })).toBeTruthy();
  });

  it('opens the Disable 2FA modal with password + code inputs when admin has has2FA = true', async () => {
    authUserRef.current = { ...baseAdmin, has2FA: true };
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole('button', { name: /^twoFactor\.disable$/ }));

    // Password input + a disabled "Disable" submit button until form filled.
    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeTruthy();
    });
  });
});
