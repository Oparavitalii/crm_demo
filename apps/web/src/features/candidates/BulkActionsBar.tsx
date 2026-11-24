import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Mail, MailCheck, Trash2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CANDIDATE_STATUSES, type Candidate, type CandidateStatus } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useUpdateCandidateById, useAnonymizeCandidate } from './api';
import { BulkConsentModal } from './BulkConsentModal';

interface Props {
  selected: Candidate[];
  onEmailClick: () => void;
  // Called after a bulk op completes (success or partial) so the parent can
  // clear its selection state.
  onAfterBulkOp: () => void;
  // 2026-06-12 — optional callback used by the mobile sticky bottom bar's
  // close (chevron) button to clear selection without firing a bulk op.
  onClear?: () => void;
}

// All 8 lifecycle statuses available in the bulk switcher. The backend
// `updateCandidate` PATCH path accepts every status; it only enforces
// "workEndReason or reasonNote required" for the terminal three
// (dismissed/cancelled/blacklist), which we satisfy with a shared
// reasonNote field. Employed / re_employed flip `kind='client'` automatically.
// Note: bulk-applying employed/re_employed does NOT collect housing or
// project — those stay at whatever value each row already has. The hire
// modal remains the canonical per-row flow when housing must be picked.
const BULK_STATUS_OPTIONS: readonly CandidateStatus[] = CANDIDATE_STATUSES;

const REASON_REQUIRED_STATUSES: ReadonlySet<CandidateStatus> = new Set([
  'dismissed',
  'cancelled',
  'blacklist',
]);

const WORK_STAGE_STATUSES: ReadonlySet<CandidateStatus> = new Set([
  'employed',
  're_employed',
]);

export function BulkActionsBar({ selected, onEmailClick, onAfterBulkOp, onClear }: Props) {
  const { t, i18n } = useTranslation(['candidates', 'communications', 'errors', 'common']);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const isMobile = useIsMobile();
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  if (selected.length === 0) return null;

  // 2026-06-12 — on mobile the title row is far too narrow for 3 extra
  // buttons. Render a sticky bottom bar instead so all three bulk actions
  // remain reachable on a 360px viewport. The bar sits at the bottom of the
  // viewport with safe-area padding so it doesn't clash with the mobile bottom
  // nav (the parent <MainShell> already pads pb=72 for the nav; this bar
  // stacks above that since position:fixed + bottom:72px would still leave
  // the bar visible — we use a fixed offset matching the MobileBottomNav
  // height so both are reachable).
  if (isMobile) {
    return (
      <>
        <Paper
          shadow="lg"
          radius={0}
          withBorder
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            // MobileBottomNav sits at 0 with height ~56px; render bulk bar
            // above it so both stay tappable. env(safe-area-inset-bottom)
            // accounts for the iOS home indicator.
            bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
            zIndex: 200,
            padding: 'var(--mantine-spacing-xs)',
          }}
        >
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap" align="center">
              <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                {t('candidates:bulk.selectedCount', {
                  defaultValue: '{{count}} wybr.',
                  count: selected.length,
                })}
              </Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                aria-label={t('candidates:bulk.clear', { defaultValue: 'Wyczyść zaznaczenie' })}
                onClick={() => onClear?.()}
              >
                <X size={18} />
              </ActionIcon>
            </Group>
            {/* Full labeled buttons (not icon-only) so the mobile bar mirrors the
                desktop toolbar. `grow` gives each an equal share of the row; short
                labels keep all three on one line even on a 360px viewport. */}
            <Group grow gap="xs" wrap="nowrap">
              {isAdmin && (
                <Button
                  variant="light"
                  color="blue"
                  size="xs"
                  leftSection={<Mail size={14} />}
                  onClick={onEmailClick}
                >
                  {t('communications:sendToSelected.buttonShort', { defaultValue: 'E-mail' })}
                </Button>
              )}
              <Button
                variant="light"
                color="teal"
                size="xs"
                leftSection={<RefreshCw size={14} />}
                onClick={() => setStatusOpen(true)}
              >
                {t('bulk.changeStatus.buttonShort', { defaultValue: 'Status' })}
              </Button>
              {isAdmin && (
                <Button
                  variant="light"
                  color="red"
                  size="xs"
                  leftSection={<Trash2 size={14} />}
                  onClick={() => setDeleteOpen(true)}
                >
                  {t('bulk.delete.buttonShort', { defaultValue: 'Usuń' })}
                </Button>
              )}
            </Group>
            {/* Consent requests on its own row — a fourth button in the row
                above would overflow a 360px viewport. Sending is admin-only. */}
            {isAdmin && (
              <Button
                variant="light"
                color="grape"
                size="xs"
                fullWidth
                leftSection={<MailCheck size={14} />}
                onClick={() => setConsentOpen(true)}
              >
                {t('bulk.consentRequest.buttonShort', { defaultValue: 'Zgody' })}
              </Button>
            )}
          </Stack>
        </Paper>

        <BulkConsentModal
          opened={consentOpen}
          onClose={() => setConsentOpen(false)}
          selected={selected}
          onDone={() => {
            setConsentOpen(false);
            onAfterBulkOp();
          }}
        />
        <BulkStatusModal
          opened={statusOpen}
          onClose={() => setStatusOpen(false)}
          selected={selected}
          onDone={() => {
            setStatusOpen(false);
            onAfterBulkOp();
          }}
          lang={i18n.language}
        />
        <BulkDeleteModal
          opened={deleteOpen && isAdmin}
          onClose={() => setDeleteOpen(false)}
          selected={selected}
          onDone={() => {
            setDeleteOpen(false);
            onAfterBulkOp();
          }}
        />
      </>
    );
  }

  return (
    <>
      {isAdmin && (
        <Button
          variant="light"
          color="blue"
          leftSection={<Mail size={16} />}
          onClick={onEmailClick}
        >
          {t('communications:sendToSelected.buttonLabel', { count: selected.length })}
        </Button>
      )}
      <Button
        variant="light"
        color="teal"
        leftSection={<RefreshCw size={16} />}
        onClick={() => setStatusOpen(true)}
      >
        {t('bulk.changeStatus.button', {
          defaultValue: 'Zmień status ({{count}})',
          count: selected.length,
        })}
      </Button>
      {isAdmin && (
        <Button
          variant="light"
          color="grape"
          leftSection={<MailCheck size={16} />}
          onClick={() => setConsentOpen(true)}
        >
          {t('bulk.consentRequest.button', {
            defaultValue: 'Prośby o zgodę ({{count}})',
            count: selected.length,
          })}
        </Button>
      )}
      {isAdmin && (
        <Button
          variant="light"
          color="red"
          leftSection={<Trash2 size={16} />}
          onClick={() => setDeleteOpen(true)}
        >
          {t('bulk.delete.button', {
            defaultValue: 'Usuń ({{count}})',
            count: selected.length,
          })}
        </Button>
      )}

      <BulkConsentModal
        opened={consentOpen}
        onClose={() => setConsentOpen(false)}
        selected={selected}
        onDone={() => {
          setConsentOpen(false);
          onAfterBulkOp();
        }}
      />
      <BulkStatusModal
        opened={statusOpen}
        onClose={() => setStatusOpen(false)}
        selected={selected}
        onDone={() => {
          setStatusOpen(false);
          onAfterBulkOp();
        }}
        lang={i18n.language}
      />
      <BulkDeleteModal
        opened={deleteOpen && isAdmin}
        onClose={() => setDeleteOpen(false)}
        selected={selected}
        onDone={() => {
          setDeleteOpen(false);
          onAfterBulkOp();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk-status change. Restricted to BULK_SAFE_STATUSES — status-flips that need
// extra data (housing, reason, etc.) must go through the per-row modal flow.
// ---------------------------------------------------------------------------
function BulkStatusModal({
  opened,
  onClose,
  selected,
  onDone,
  lang,
}: {
  opened: boolean;
  onClose: () => void;
  selected: Candidate[];
  onDone: () => void;
  lang: string;
}) {
  const { t } = useTranslation(['candidates', 'common', 'errors']);
  const update = useUpdateCandidateById();
  const { data: statusLookup } = useStatusLookup('candidate_status');
  const [target, setTarget] = useState<CandidateStatus | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const statusOptions = BULK_STATUS_OPTIONS.map((code) => {
    const row = statusLookup?.find((r) => r.code === code);
    const label = row
      ? lang === 'pl'
        ? row.labelPl
        : row.labelUa
      : t(`status.${code}`, { defaultValue: code });
    return { value: code, label };
  });

  const needsReason = target !== null && REASON_REQUIRED_STATUSES.has(target);
  const reasonInvalid = needsReason && reasonNote.trim().length === 0;

  async function run() {
    if (!target) return;
    if (reasonInvalid) return;
    setRunning(true);
    setProgress(0);
    let ok = 0;
    let failed = 0;
    const patch: { status: CandidateStatus; reasonNote?: string } = { status: target };
    if (needsReason) patch.reasonNote = reasonNote.trim();
    for (let i = 0; i < selected.length; i++) {
      const row = selected[i]!;
      try {
        await update.mutateAsync({ id: row.id, patch });
        ok++;
      } catch {
        failed++;
      }
      setProgress(((i + 1) / selected.length) * 100);
    }
    notifications.show({
      color: failed === 0 ? 'green' : failed === selected.length ? 'red' : 'yellow',
      message: t('bulk.changeStatus.result', {
        defaultValue: 'Zmieniono status: {{ok}} OK, {{failed}} błędów',
        ok,
        failed,
      }),
    });
    setRunning(false);
    onDone();
  }

  return (
    <Modal
      opened={opened}
      onClose={running ? () => undefined : onClose}
      title={t('bulk.changeStatus.title', { defaultValue: 'Zmień status zaznaczonych' })}
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t('bulk.changeStatus.hint', {
            defaultValue:
              'Zaznaczonych: {{count}}. Można zmienić tylko na status nie wymagający dodatkowych danych.',
            count: selected.length,
          })}
        </Text>
        <Select
          label={t('bulk.changeStatus.target', { defaultValue: 'Nowy status' })}
          data={statusOptions}
          value={target}
          onChange={(v) => setTarget(v as CandidateStatus | null)}
          disabled={running}
          required
        />
        {needsReason && (
          <Textarea
            label={t('bulk.changeStatus.reasonNote', { defaultValue: 'Powód (wspólny dla wszystkich)' })}
            description={t('bulk.changeStatus.reasonNoteHint', {
              defaultValue:
                'Tekst zostanie zapisany jako reason_note dla każdego z {{count}} wybranych kandydatów.',
              count: selected.length,
            })}
            value={reasonNote}
            onChange={(e) => setReasonNote(e.currentTarget.value)}
            minRows={2}
            autosize
            maxLength={2000}
            disabled={running}
            required
            error={reasonInvalid ? t('bulk.changeStatus.reasonRequired', { defaultValue: 'Wymagane' }) : undefined}
          />
        )}
        {target === 'blacklist' && (
          <Alert color="red" variant="light">
            {t('bulk.changeStatus.blacklistWarning', {
              defaultValue:
                'Uwaga: czarna lista to terminalny status — wycofanie jest możliwe tylko przez admina i pojedynczo.',
            })}
          </Alert>
        )}
        {target !== null && WORK_STAGE_STATUSES.has(target) && (
          <Alert color="yellow" variant="light">
            {t('bulk.changeStatus.workStageWarning', {
              defaultValue:
                'Uwaga: zbiorcza zmiana statusu na „Pracuje” / „Ponownie pracuje” nie ustawia mieszkania, projektu ani koordynatora. Aby je przypisać, użyj okna „Zatrudnij” na karcie konkretnego kandydata.',
            })}
          </Alert>
        )}
        {running && <Progress value={progress} animated />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={running}>
            {t('common:actions.cancel', { defaultValue: 'Anuluj' })}
          </Button>
          <Button
            color="teal"
            onClick={run}
            loading={running}
            disabled={!target || reasonInvalid}
          >
            {t('bulk.changeStatus.submit', { defaultValue: 'Zastosuj' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bulk delete (anonymize). Admin-only — gate already enforced by the parent
// button, but we also guard the backend call. Anonymize is irreversible.
// ---------------------------------------------------------------------------
function BulkDeleteModal({
  opened,
  onClose,
  selected,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  selected: Candidate[];
  onDone: () => void;
}) {
  const { t } = useTranslation(['candidates', 'common', 'errors']);
  const anonymize = useAnonymizeCandidate();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  async function run() {
    setRunning(true);
    setProgress(0);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < selected.length; i++) {
      const row = selected[i]!;
      try {
        await anonymize.mutateAsync(row.id);
        ok++;
      } catch {
        failed++;
      }
      setProgress(((i + 1) / selected.length) * 100);
    }
    notifications.show({
      color: failed === 0 ? 'green' : failed === selected.length ? 'red' : 'yellow',
      message: t('bulk.delete.result', {
        defaultValue: 'Usunięto: {{ok}} OK, {{failed}} błędów',
        ok,
        failed,
      }),
    });
    setRunning(false);
    onDone();
  }

  return (
    <Modal
      opened={opened}
      onClose={running ? () => undefined : onClose}
      title={t('bulk.delete.title', { defaultValue: 'Usuń zaznaczonych' })}
      centered
    >
      <Stack>
        <Text size="sm">
          {t('bulk.delete.confirm', {
            defaultValue:
              'Czy na pewno usunąć (zanonimizować) {{count}} kandydatów? Operacja nieodwracalna.',
            count: selected.length,
          })}
        </Text>
        {running && <Progress value={progress} color="red" animated />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={running}>
            {t('common:actions.cancel', { defaultValue: 'Anuluj' })}
          </Button>
          <Button color="red" onClick={run} loading={running}>
            {t('bulk.delete.submit', { defaultValue: 'Usuń' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
