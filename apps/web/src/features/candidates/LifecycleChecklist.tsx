import { useState } from 'react';
import { Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import { CANDIDATE_STATUSES, type Candidate, type CandidateStatus } from '@crm/shared';
import { useUpdateCandidate } from './api';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { parseApiError } from '@/lib/http';
import { HireModal } from './HireModal';
import { DismissModal } from './DismissModal';
import { CancelModal } from './CancelModal';

// 2026-06-12: "Change info" card with a quick status switcher. For lifecycle
// statuses the switcher opens the matching modal instead of issuing a raw
// PATCH — hire needs a start date (employment_periods row), dismiss needs the
// end date, cancel offers an optional reason. Since 2026-07-02 reasons are
// optional everywhere; the modals remain for the dates + optional context.

const STATUSES_REQUIRING_HIRE_MODAL = new Set<CandidateStatus>(['employed', 're_employed']);
const STATUSES_REQUIRING_DISMISS_MODAL = new Set<CandidateStatus>(['dismissed']);
const STATUSES_REQUIRING_CANCEL_MODAL = new Set<CandidateStatus>(['cancelled', 'blacklist']);

function Row({
  icon,
  label,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        {icon}
        <Text size="sm" fw={500}>
          {label}
        </Text>
      </Group>
      {badge}
    </Group>
  );
}

export function LifecycleChecklist({ candidate: c }: { candidate: Candidate }) {
  const { t, i18n } = useTranslation('candidates');
  const update = useUpdateCandidate(c.id);
  // Modal state — driven by the status Select picking a status that needs
  // extra data. We force the Select back to the current status on close so
  // the placeholder doesn't stay stuck on the half-selected option.
  const [hireOpen, setHireOpen] = useState(false);
  const [hireMode, setHireMode] = useState<'hire' | 'rehire'>('hire');
  const [dismissOpen, setDismissOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Used purely as the Select's controlled value so we can flip back to
  // c.status while a modal is open (without rolling back to it mid-flow).
  const [draftStatus, setDraftStatus] = useState<CandidateStatus | null>(null);

  const { data: statusLookup } = useStatusLookup('candidate_status');
  const statusLabel = (code: CandidateStatus): string => {
    const row = statusLookup?.find((r) => r.code === code);
    if (row) return i18n.language === 'pl' ? row.labelPl : row.labelUa;
    return t(`status.${code}`, { defaultValue: code });
  };
  const statusOptions = CANDIDATE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

  function plainPatch(target: CandidateStatus) {
    update.mutate(
      { status: target },
      {
        onError: (err) => {
          const info = parseApiError(err);
          const detail = info.code
            ? `${info.code}${info.meta ? ': ' + JSON.stringify(info.meta) : ''}`
            : '';
          notifications.show({
            color: 'red',
            message: detail
              ? `${t('errors.statusUpdateFailed', { defaultValue: 'Не вдалося змінити статус' })} — ${detail}`
              : t('errors.statusUpdateFailed', { defaultValue: 'Не вдалося змінити статус' }),
            autoClose: 8000,
          });
        },
      },
    );
  }

  function setStatus(v: string | null) {
    if (!v || v === c.status) return;
    const target = v as CandidateStatus;

    // Hire / Re-hire — needs housing + project + coordinator. The `rehire`
    // variant exists for the dismissed → re_employed loop; we route to it
    // when the current status is `dismissed`, otherwise it's a fresh hire.
    if (STATUSES_REQUIRING_HIRE_MODAL.has(target)) {
      setHireMode(target === 're_employed' || c.status === 'dismissed' ? 'rehire' : 'hire');
      setDraftStatus(target);
      setHireOpen(true);
      return;
    }
    // Dismiss — collects workEndDate + reasonCode + note via DismissModal,
    // posts to /candidates/:id/dismiss (closes employment_period + flips
    // status to 'dismissed' in one transaction).
    if (STATUSES_REQUIRING_DISMISS_MODAL.has(target)) {
      setDraftStatus(target);
      setDismissOpen(true);
      return;
    }
    // Cancel / Blacklist — CancelModal serialises the optional "code: note"
    // into candidates.reason_note.
    if (STATUSES_REQUIRING_CANCEL_MODAL.has(target)) {
      setDraftStatus(target);
      setCancelOpen(true);
      return;
    }
    // Safe forward transitions (new / in_progress / documents_submitted) just
    // PATCH directly.
    plainPatch(target);
  }

  const selectValue = draftStatus ?? c.status;
  const statusIcon = <Activity size={18} color="var(--mantine-color-blue-6)" />;
  const statusSelect = (
    <Select
      size="xs"
      w={220}
      data={statusOptions}
      value={selectValue}
      onChange={setStatus}
      allowDeselect={false}
      disabled={update.isPending}
      aria-label={t('fields.status')}
    />
  );

  return (
    <>
      <Paper withBorder p="lg" radius="md" shadow="sm">
        <Stack gap="sm">
          {/* "Change info" — literal English label per product request. */}
          <Title order={4}>Change info</Title>
          <Row icon={statusIcon} label={t('fields.status')} badge={statusSelect} />
        </Stack>
      </Paper>

      <HireModal
        opened={hireOpen}
        onClose={() => {
          setHireOpen(false);
          setDraftStatus(null);
        }}
        candidateId={c.id}
        mode={hireMode}
      />
      <DismissModal
        opened={dismissOpen}
        onClose={() => {
          setDismissOpen(false);
          setDraftStatus(null);
        }}
        candidateId={c.id}
      />
      <CancelModal
        opened={cancelOpen}
        onClose={() => {
          setCancelOpen(false);
          setDraftStatus(null);
        }}
        candidateId={c.id}
      />
    </>
  );
}
