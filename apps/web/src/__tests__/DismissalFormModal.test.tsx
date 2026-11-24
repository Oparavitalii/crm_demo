// @vitest-environment jsdom
/**
 * DismissalFormModal.test.tsx — covers the create + edit modal flow.
 *
 * The dismissals-api hooks (useCreateDismissal / useUpdateDismissal) are
 * mocked so we can assert on the exact payload shape that the mutation
 * receives without going through react-query/network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from './test-utils';

// Hoisted mutation spies, reused across tests.
const createMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock('../features/candidates/dismissals-api', () => ({
  useCreateDismissal: () => ({
    mutate: createMutate,
    isPending: false,
  }),
  useUpdateDismissal: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}));

// The reason field is a LookupSelect backed by status_lookups. There is no
// network in these tests, so the taxonomy is stubbed — the modal must offer
// exactly these options and store the CODE, never the label.
const REASONS = [
  { id: 'r1', type: 'dismissal_reason', code: 'absenteeism', labelPl: 'Absencja', labelUa: 'Прогули', sortOrder: 1, isActive: true, isSystem: false },
  { id: 'r2', type: 'dismissal_reason', code: 'health_issues', labelPl: 'Stan zdrowia', labelUa: 'Стан здоровʼя', sortOrder: 2, isActive: true, isSystem: false },
];

vi.mock('../features/admin-statuses/useStatusLookup', () => ({
  useStatusLookup: () => ({ data: REASONS }),
  useCreateStatusLookup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DismissalFormModal } from '../features/candidates/DismissalFormModal';

function fieldLabel(key: string): RegExp {
  return new RegExp(`^${key.replace(/\./g, '\\.')}(\\s*\\*)?$`);
}

function getInput(key: string): HTMLInputElement {
  const matches = screen.getAllByLabelText(fieldLabel(key));
  const input = matches.find((el) => el.tagName === 'INPUT');
  if (!input) throw new Error(`No input found for label ${key}`);
  return input as HTMLInputElement;
}

// Mantine Select shows labels and yields codes. Tests pick by the label a
// user would actually see, which is the point of the control: there is no
// path here that puts an arbitrary string in the database.
//
// The i18n stub in test-utils runs with lng: 'pl', so LookupSelect renders
// labelPl — pick by the Polish label and assert on the code.
async function pickReason(user: ReturnType<typeof userEvent.setup>, labelPl: string) {
  await user.click(getInput('dismissals.fields.reason'));
  await user.click(await screen.findByText(labelPl));
}

const candidateId = '11111111-1111-4111-8111-111111111111';

describe('DismissalFormModal', () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
  });

  it('renders fields when opened=true', () => {
    renderWithProviders(
      <DismissalFormModal opened onClose={vi.fn()} candidateId={candidateId} />,
    );
    expect(getInput('dismissals.fields.reason')).toBeTruthy();
  });

  it('does NOT render any form fields when opened=false', () => {
    renderWithProviders(
      <DismissalFormModal opened={false} onClose={vi.fn()} candidateId={candidateId} />,
    );
    // When the modal is closed Mantine does not mount its contents.
    expect(screen.queryByLabelText(fieldLabel('dismissals.fields.reason'))).toBeNull();
  });

  it('blocks submit when reason is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DismissalFormModal opened onClose={vi.fn()} candidateId={candidateId} />,
    );
    await user.click(screen.getByRole('button', { name: 'dismissals.form.submit' }));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('happy path: submit calls create mutation with `reason` AND `reasonCode` equal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <DismissalFormModal opened onClose={onClose} candidateId={candidateId} />,
    );

    await pickReason(user, 'Absencja');
    await user.click(screen.getByRole('button', { name: 'dismissals.form.submit' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const [payload] = createMutate.mock.calls[0]!;
    expect(payload).toMatchObject({
      candidateId,
      reason: 'absenteeism',
      reasonCode: 'absenteeism',
    });
    // dismissedAt is defaulted to "now" — just verify it's an ISO datetime.
    expect(typeof payload.dismissedAt).toBe('string');
    expect(Number.isNaN(Date.parse(payload.dismissedAt))).toBe(false);
  });

  it('stores the CODE, not the label the user clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DismissalFormModal opened onClose={vi.fn()} candidateId={candidateId} />,
    );

    // The regression this guards: the field used to be a free-text
    // Autocomplete that saved whatever was displayed. A Ukrainian recruiter
    // stored "Стан здоровʼя" and a Polish one stored "Stan zdrowia" for the
    // same reason, so the retention report counted them as two causes and
    // nothing ever merged them.
    await pickReason(user, 'Stan zdrowia');
    await user.click(screen.getByRole('button', { name: 'dismissals.form.submit' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const [payload] = createMutate.mock.calls[0]!;
    expect(payload.reason).toBe('health_issues');
    expect(payload.reasonCode).toBe('health_issues');
    expect(payload.reason).not.toBe('Stan zdrowia');
  });

  it('edit mode: uses update mutation rather than create', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DismissalFormModal
        opened
        onClose={vi.fn()}
        candidateId={candidateId}
        initial={{
          id: '22222222-2222-4222-8222-222222222222',
          candidateId,
          dismissedAt: '2026-01-15T10:00:00.000Z',
          reason: 'absenteeism',
          reasonCode: 'absenteeism',
          recordedById: null,
          notes: null,
          createdAt: '2026-01-15T10:00:00.000Z',
        }}
      />,
    );

    // Change the reason to trigger a save.
    await pickReason(user, 'Stan zdrowia');

    await user.click(screen.getByRole('button', { name: 'dismissals.form.submit' }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).not.toHaveBeenCalled();
    const [args] = updateMutate.mock.calls[0]!;
    expect(args.patch).toMatchObject({
      reason: 'health_issues',
      reasonCode: 'health_issues',
    });
    expect(args.candidateId).toBe(candidateId);
  });
});
