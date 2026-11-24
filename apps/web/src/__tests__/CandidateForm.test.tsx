// @vitest-environment jsdom
/**
 * CandidateForm.test.tsx — component tests for the candidate create/edit form.
 *
 * We mock the read-only directory hook the form depends on so the test does
 * not perform any network I/O. ProjectSelect is also mocked to a trivial stub
 * so the test stays focused on CandidateForm's own validation + payload-shape
 * contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from './test-utils';

// Mantine appends " *" to required field labels via a sibling <span>. We need
// an exact-or-required match so `field` matches both "field" and "field *"
// without also catching e.g. "fieldRequired".
function fieldLabel(key: string): RegExp {
  return new RegExp(`^${key.replace(/\./g, '\\.')}(\\s*\\*)?$`);
}

// Autocomplete + Select wrap a popover that is also `aria-labelledby` the same
// label id, so `getByLabelText` returns both the input AND the popover. We
// always want the <input> (or its underlying text input) for typing/value
// assertions.
function getInput(key: string): HTMLInputElement {
  const matches = screen.getAllByLabelText(fieldLabel(key));
  const input = matches.find((el) => el.tagName === 'INPUT');
  if (!input) throw new Error(`No input found for label ${key}`);
  return input as HTMLInputElement;
}

vi.mock('@/features/directory/api', () => ({
  useDirectoryUsers: () => ({ data: { items: [] } }),
}));

vi.mock('@/features/projects/ProjectSelect', () => ({
  ProjectSelect: () => null,
}));

// Source / no-show / status lookups now drive Select dropdowns — return a
// minimal set of canonical options so tests can pick from them.
// Labels intentionally match codes so test assertions can stay readable —
// Mantine Select displays `label`, but form state holds `value`.
vi.mock('@/features/admin-statuses/useStatusLookup', () => ({
  useStatusLookup: (type: string) => {
    if (type === 'sources') {
      return {
        data: [
          { id: 's1', type: 'sources', code: 'website', labelPl: 'website', labelUa: 'website', groupKey: 'website', sortOrder: 10, isSystem: true, deletedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdById: null },
          { id: 's2', type: 'sources', code: 'facebook', labelPl: 'facebook', labelUa: 'facebook', groupKey: 'social', sortOrder: 20, isSystem: true, deletedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdById: null },
        ],
      };
    }
    return { data: [] };
  },
  useCreateStatusLookup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// F3: the form now reads the current user from useAuthStore to default-fill
// the recruiterId. Mock as a `recruiter` so defaultRecruiterId is non-empty,
// the recruiter Select is hidden, and validation passes for the happy-path
// tests below that don't exercise the picker.
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: '00000000-0000-4000-8000-000000000001', role: 'recruiter' },
    }),
}));

import { CandidateForm } from '../features/candidates/CandidateForm';

function setup(overrides: Partial<Parameters<typeof CandidateForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = renderWithProviders(
    <CandidateForm
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitting={false}
      submitLabel="Save"
      {...overrides}
    />,
  );
  return { onSubmit, onCancel, ...utils };
}

describe('CandidateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the required base fields', () => {
    setup();
    expect(getInput('fields.fullName')).toBeTruthy();
    expect(getInput('fields.status')).toBeTruthy();
    expect(getInput('fields.source')).toBeTruthy();
  });

  it('blocks submit when required fields are empty', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Timeout bumped to 15s: this form mounts ~14 LookupSelect / Select / DateInput
  // controls, and every `user.type` keystroke re-renders the whole tree. The
  // 17-character `user.type` below alone takes ~3s without coverage and ~6s
  // under v8 coverage instrumentation, which trips the default 5s budget. The
  // test is doing legitimate work; raising the budget is the right call.
  it('calls onSubmit with trimmed, null-padded payload on happy path', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    // `paste` instead of `type` skips the per-character render storm — same
    // result (raw value lands in the input), one event instead of seventeen.
    const nameInput = getInput('fields.fullName');
    nameInput.focus();
    await user.paste('  Anna Kowalska  ');
    // Source: pick from the Select dropdown (admin-managed lookup).
    await user.click(getInput('fields.source'));
    await user.click(await screen.findByText('website'));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload).toMatchObject({
      name: 'Anna Kowalska',
      email: null,
      phone: null,
      nationality: null,
      workEndReason: null,
      reasonNote: null,
      notes: null,
      status: 'new',
      projectId: null,
      coordinatorId: null,
      source: 'website',
      messenger: null,
      experience: null,
    });
  });

  it('populates fields from `initial` prop (edit mode)', () => {
    setup({
      initial: {
        name: 'Ivan Shevchenko',
        email: 'ivan@example.com',
        phone: '+48123456789',
        nationality: 'UA',
        status: 'in_progress',
        source: 'facebook',
      },
    });
    expect((getInput('fields.fullName') as HTMLInputElement).value).toBe('Ivan Shevchenko');
    expect((getInput('fields.email') as HTMLInputElement).value).toBe('ivan@example.com');
    expect((getInput('fields.phone') as HTMLInputElement).value).toBe('+48123456789');
    expect((getInput('fields.nationality') as HTMLInputElement).value).toBe('UA');
    expect((getInput('fields.source') as HTMLInputElement).value).toBe('facebook');
  });

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup();
    await user.click(screen.getByRole('button', { name: 'form.cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // 2026-07-10 dirty-diff contract: in edit mode the second onSubmit argument
  // holds ONLY the fields the user actually changed. Untouched legacy values
  // (e.g. the imported phone "380936645458.0" that predates today's stricter
  // validation) must NOT be re-sent — re-sending them made every save 400.
  it('edit mode: second onSubmit arg contains only the changed fields', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({
      initial: {
        name: 'Legacy Import',
        phone: '380936645458.0',
        status: 'employed',
        messenger: '@old-handle',
      },
    });

    const msgInput = getInput('fields.messenger');
    await user.clear(msgInput);
    await user.type(msgInput, '@new');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const changed = onSubmit.mock.calls[0]![1];
    expect(changed).toEqual({ messenger: '@new' });
  });

  // Same render-storm reasoning as the happy-path test above — under coverage
  // the initial mount of the 14-control form plus waitFor on submit eats the
  // default 5s budget.
  it('preserves a soft-deleted source code on edit (buildLookupOptions appends current)', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    // initial.source 'olx' is NOT in the active lookup but buildLookupOptions
    // appends it so the existing value stays selectable and submitted unchanged.
    const { onSubmit } = setup({
      initial: {
        name: 'Petr Dolyna',
        source: 'olx',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].source).toBe('olx');
  });
});
