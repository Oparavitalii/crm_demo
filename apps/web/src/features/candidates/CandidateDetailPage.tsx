import { useState } from 'react';
import { ActionIcon, Badge, Button, Container, Divider, Group, Paper, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ArrowLeft, Download, Edit, Trash2, UserMinus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { Candidate } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useAuditLog } from '@/features/admin-audit/api';
import { useStatusLookup, pickLabel } from '@/features/admin-statuses/useStatusLookup';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useCandidate, useAnonymizeCandidate, downloadCandidateExport } from './api';
import { STATUS_COLORS } from './columns';
import { hiddenFieldsForRole } from './roleFieldVisibility';
import { LifecycleChecklist } from './LifecycleChecklist';
import { DismissalsTab } from './DismissalsTab';
import { CandidateComments } from '@/features/candidate-comments/CandidateComments';
import { CandidateTasksTab } from '@/features/tasks/CandidateTasksTab';
import { DismissModal } from './DismissModal';
import { EmploymentHistoryTab } from './EmploymentHistoryTab';
import { CandidateConsentSection } from './CandidateConsentSection';

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  // value renders as a <span> so callers can safely pass another Mantine
  // <Text> (which itself becomes <p>) without producing invalid nested-<p>
  // HTML and the React hydration warning that comes with it.
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text c="dimmed" size="sm">{label}</Text>
      <Text component="span">{value || '—'}</Text>
    </Group>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CandidateAuditSection({ candidateId }: { candidateId: string }) {
  const { t } = useTranslation('candidates');
  const { data, isPending } = useAuditLog({
    entityType: 'candidate',
    entityId: candidateId,
    page: 1,
    pageSize: 20,
  });
  const items = data?.items ?? [];

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm">
      <Stack>
        <Title order={4}>{t('detail.sections.audit')}</Title>
        {isPending && <Text c="dimmed" size="sm">...</Text>}
        {!isPending && items.length === 0 && (
          <Text c="dimmed" size="sm">{t('detail.audit.empty')}</Text>
        )}
        {items.length > 0 && (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('detail.audit.createdAt')}</Table.Th>
                <Table.Th>{t('detail.audit.action')}</Table.Th>
                <Table.Th>{t('detail.audit.actor')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{new Date(item.createdAt).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">{item.action}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" truncate maw={240}>
                      {item.actorFirstName || item.actorLastName
                        ? `${item.actorFirstName ?? ''} ${item.actorLastName ?? ''}`.trim()
                        : (item.actorId ?? '—')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

function CandidateDetailInner({ candidate: c }: { candidate: Candidate }) {
  const { t, i18n } = useTranslation(['candidates', 'errors', 'operations', 'admin']);
  const { data: statusLookup } = useStatusLookup('candidate_status');
  const { data: dismissalReasonLookup } = useStatusLookup('dismissal_reason');
  // 2026-06-12: every status_lookups-backed field on the candidate is rendered
  // as a code on the row, not a human label — pull each list once and convert
  // via pickLabel. The hooks share a TanStack Query cache so duplicate calls
  // across components are free.
  const { data: positionLookup } = useStatusLookup('position');
  const { data: legalStatusLookup } = useStatusLookup('legal_status');
  const { data: sourceLookup } = useStatusLookup('sources');
  const { data: workOutcomeLookup } = useStatusLookup('work_outcome');
  const { data: payoutStatusLookup } = useStatusLookup('payout_status');
  const { data: paymentStatusLookup } = useStatusLookup('payment_status');
  const { data: retentionLookup } = useStatusLookup('retention');
  const statusLabel = (() => {
    const row = statusLookup?.find((r) => r.code === c.status);
    if (row) return i18n.language === 'pl' ? row.labelPl : row.labelUa;
    return t(`status.${c.status}`, { defaultValue: c.status });
  })();
  const workEndReasonLabel = pickLabel(dismissalReasonLookup, c.workEndReason, i18n.language).label;
  const positionLabel = pickLabel(positionLookup, c.position, i18n.language).label;
  const legalStatusLabel = pickLabel(legalStatusLookup, c.legalStatus, i18n.language).label;
  const sourceLabel = pickLabel(sourceLookup, c.source, i18n.language).label;
  const workOutcomeLabel = pickLabel(workOutcomeLookup, c.workOutcome, i18n.language).label;
  const payoutStatusLabel = pickLabel(payoutStatusLookup, c.payoutStatus, i18n.language).label;
  const paymentStatusLabel = pickLabel(paymentStatusLookup, c.paymentStatus, i18n.language).label;
  const retentionLabel = pickLabel(retentionLookup, c.retention, i18n.language).label;
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  // 2026-07-08 — accounting fields scoped by role (see roleFieldVisibility.ts);
  // same set drives the list columns, so the card can't leak what the table hides.
  const hiddenFields = hiddenFieldsForRole(role);
  const anonymize = useAnonymizeCandidate();
  const apiErrorMessage = useApiErrorMessage();
  const isMobile = useIsMobile();
  const [exportLoading, setExportLoading] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  // Only "Dismiss" remains as a standalone header action; Hire and Cancel are
  // now performed via the status switcher in LifecycleChecklist.
  const canDismiss = role !== 'readonly' && (c.status === 'employed' || c.status === 're_employed');

  function handleDelete() {
    modals.openConfirmModal({
      title: t('detail.delete'),
      children: <Text>{t('detail.deleteConfirm')}</Text>,
      labels: { confirm: t('detail.delete'), cancel: t('form.cancel') },
      confirmProps: { color: 'red', loading: anonymize.isPending },
      onConfirm: () => {
        anonymize.mutate(c.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('detail.deleted') });
            navigate('/candidates');
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message: code === 'FORBIDDEN' ? t('errors.noPermission') : apiErrorMessage(err),
              autoClose: 8000,
            });
          },
        });
      },
    });
  }

  async function handleExport() {
    setExportLoading(true);
    try {
      await downloadCandidateExport(c.id);
      notifications.show({ color: 'green', message: t('admin:export.success') });
    } catch {
      notifications.show({ color: 'red', message: t('admin:export.error') });
    } finally {
      setExportLoading(false);
    }
  }

  // Header actions — the SAME set on desktop and mobile. `compact` shrinks them
  // so all four fit a phone row (rendered below the title on mobile, inline on
  // desktop) instead of being collapsed into a kebab menu.
  const actionButtons = (compact: boolean) => {
    const iconSize = compact ? 14 : 16;
    const size = compact ? 'xs' : 'sm';
    return (
      <>
        <Button
          size={size}
          leftSection={<Edit size={iconSize} />}
          onClick={() => navigate(`/candidates/${c.id}/edit`)}
        >
          {t('detail.edit')}
        </Button>
        {canDismiss && (
          <Button
            size={size}
            color="red"
            variant="light"
            leftSection={<UserMinus size={iconSize} />}
            onClick={() => setDismissOpen(true)}
          >
            {t('dismiss.button', { defaultValue: 'Звільнити' })}
          </Button>
        )}
        {role === 'admin' && (
          <Button
            size={size}
            color="blue"
            variant="light"
            leftSection={<Download size={iconSize} />}
            loading={exportLoading}
            onClick={() => void handleExport()}
          >
            {t('admin:export.button')}
          </Button>
        )}
        {role === 'admin' && !c.anonymizedAt && (
          <Button
            size={size}
            color="red"
            variant="light"
            leftSection={<Trash2 size={iconSize} />}
            onClick={handleDelete}
          >
            {t('detail.delete')}
          </Button>
        )}
      </>
    );
  };

  return (
    <Container size="md">
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          {isMobile ? (
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label={t('detail.back')}
              onClick={() => navigate('/candidates')}
            >
              <ArrowLeft size={18} />
            </ActionIcon>
          ) : (
            <Button variant="subtle" leftSection={<ArrowLeft size={16} />} onClick={() => navigate('/candidates')}>
              {t('detail.back')}
            </Button>
          )}
          <Title order={isMobile ? 4 : 2} data-reveal style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Title>
          <Badge color={STATUS_COLORS[c.status]} variant="light">
            {statusLabel}
          </Badge>
        </Group>
        {/* Desktop keeps the actions inline in the title row. On mobile they
            drop to their own wrapping row below the title (rendered right after
            this Group) so a 360px screen isn't cramped — but the SAME buttons
            are shown, not a collapsed kebab menu. */}
        {!isMobile && <Group>{actionButtons(false)}</Group>}
      </Group>
      {isMobile && (
        <Group wrap="wrap" gap="xs" mb="md">
          {actionButtons(true)}
        </Group>
      )}
      <DismissModal
        opened={dismissOpen}
        onClose={() => setDismissOpen(false)}
        candidateId={c.id}
      />

      <Tabs defaultValue="info">
        <Tabs.List>
          {/* 2026-06-12: Info tab now carries the full candidate detail (every
              non-system field grouped into sections), so the standalone "Все"
              tab was removed — it duplicated this content 1:1. Comments stay
              embedded at the bottom (also reachable via the Коментарі tab). */}
          <Tabs.Tab value="info">{t('candidates:detail.tabInfo', 'Info')}</Tabs.Tab>
          {/* History tab — only meaningful once the candidate has been
              employed at least once. Driven by status (post-hire bucket)
              instead of the deprecated `kind` column. */}
          {(c.status === 'employed' || c.status === 're_employed' || c.status === 'dismissed') && (
            <Tabs.Tab value="history">
              {t('candidates:history.tab', { defaultValue: 'Історія працевлаштування' })}
            </Tabs.Tab>
          )}
          <Tabs.Tab value="dismissals">{t('operations:dismissals.list.title')}</Tabs.Tab>
          <Tabs.Tab value="comments">{t('candidates:comments.title')}</Tabs.Tab>
          <Tabs.Tab value="tasks">{t('candidates:detail.tabs.tasks')}</Tabs.Tab>
        </Tabs.List>

        {(c.status === 'employed' || c.status === 're_employed' || c.status === 'dismissed') && (
          <Tabs.Panel value="history" pt="md">
            <EmploymentHistoryTab candidateId={c.id} />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="info" pt="md">
          <Stack gap="md">
            {/* 1. Quick-edit card (status switcher + housing/project/docs
                toggles). Rendered first so the most-used controls are
                immediately above the read-only fields. */}
            <LifecycleChecklist candidate={c} />

            {/* 2. Personal — name + contact + birth + nationality + experience. */}
            <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
              <Stack>
                <Title order={4}>{t('candidates:detail.sections.personal')}</Title>
                <FieldRow label={t('fields.fullName')} value={c.name} />
                <FieldRow label={t('fields.email')} value={c.email} />
                <FieldRow label={t('fields.phone')} value={c.phone} />
                <FieldRow label={t('fields.messenger')} value={c.messenger} />
                <FieldRow label={t('fields.birthDate')} value={c.birthDate} />
                <FieldRow label={t('fields.nationality')} value={c.nationality} />
                {c.experience && (
                  <>
                    <Divider />
                    <Text c="dimmed" size="sm">{t('fields.experience')}</Text>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{c.experience}</Text>
                  </>
                )}
              </Stack>
            </Paper>

            {/* 2b. Marketing consent — status flags + record/copy-link actions. */}
            <CandidateConsentSection candidate={c} />

            {/* 3. Legal status / documents milestone. */}
            <Paper withBorder p="lg" radius="md" shadow="sm">
              <Stack>
                <Title order={4}>{t('fields.legalStatus')}</Title>
                <FieldRow label={t('fields.legalStatus')} value={legalStatusLabel || null} />
                {!hiddenFields.has('documentsSubmittedAt') && (
                  <FieldRow label={t('fields.documentsSubmittedAt')} value={c.documentsSubmittedAt ? new Date(c.documentsSubmittedAt).toLocaleDateString() : null} />
                )}
              </Stack>
            </Paper>

            {/* 4. Pipeline + work + reasons. */}
            <Paper withBorder p="lg" radius="md" shadow="sm">
              <Stack>
                <Title order={4}>{t('candidates:detail.sections.work')}</Title>
                <Group justify="space-between" wrap="nowrap">
                  <Text c="dimmed" size="sm">{t('fields.status')}</Text>
                  <Badge color={STATUS_COLORS[c.status]} variant="light">
                    {statusLabel}
                  </Badge>
                </Group>
                {!hiddenFields.has('source') && (
                  <FieldRow label={t('fields.source')} value={sourceLabel || null} />
                )}
                <FieldRow label={t('fields.project')} value={c.projectName ?? c.projectId} />
                <FieldRow label={t('fields.position')} value={positionLabel || null} />
                <FieldRow label={t('fields.housing')} value={c.housingType ? t(`housing.${c.housingType}`) : null} />
                <FieldRow label={t('fields.arrivedAt')} value={c.arrivedAt ? new Date(c.arrivedAt).toLocaleDateString() : null} />
                <FieldRow label={t('fields.workStartDate')} value={c.workStartDate ? new Date(c.workStartDate).toLocaleDateString() : null} />
                <FieldRow label={t('fields.workEndDate')} value={c.workEndDate ? new Date(c.workEndDate).toLocaleDateString() : null} />
                {c.workEndReason && (
                  <>
                    <Divider />
                    <Text c="dimmed" size="sm">{t('fields.workEndReason')}</Text>
                    <Text>{workEndReasonLabel}</Text>
                  </>
                )}
                {c.reasonNote && (
                  <>
                    <Divider />
                    <Text c="dimmed" size="sm">{t('fields.reasonNote')}</Text>
                    <Text style={{ whiteSpace: 'pre-line' }}>{c.reasonNote}</Text>
                  </>
                )}
              </Stack>
            </Paper>

            {/* 5. Team — recruiter / coordinator / freelancer badge. */}
            <Paper withBorder p="lg" radius="md" shadow="sm">
              <Stack>
                <Title order={4}>{t('candidates:detail.sections.team', { defaultValue: 'Команда' })}</Title>
                <FieldRow
                  label={t('fields.recruiter')}
                  value={c.recruiterFirstName || c.recruiterLastName
                    ? `${c.recruiterFirstName ?? ''} ${c.recruiterLastName ?? ''}`.trim()
                    : c.recruiterId}
                />
                <FieldRow
                  label={t('fields.coordinator')}
                  value={c.coordinatorFirstName || c.coordinatorLastName
                    ? `${c.coordinatorFirstName ?? ''} ${c.coordinatorLastName ?? ''}`.trim()
                    : c.coordinatorId}
                />
                <FieldRow
                  label={t('detail.fields.freelancer')}
                  value={
                    c.recruiterId == null || c.recruiterIsFreelancer == null ? null : (
                      c.recruiterIsFreelancer ? (
                        <Badge color="orange" variant="light">
                          {t('recruiterType.freelance', { defaultValue: 'Фрілансер' })}
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light">
                          {t('recruiterType.staff', { defaultValue: 'Наш' })}
                        </Badge>
                      )
                    )
                  }
                />
              </Stack>
            </Paper>

            {/* 6. Reconciliation (Block 7) — month-end accounting badges. */}
            <Paper withBorder p="lg" radius="md" shadow="sm">
              <Stack>
                <Title order={4}>{t('candidates:detail.sections.reconciliation', { defaultValue: 'Звірка / Виплати' })}</Title>
                {!hiddenFields.has('reconciliationPeriod') && (
                  <FieldRow label={t('fields.reconciliationPeriod')} value={c.reconciliationPeriod} />
                )}
                {!hiddenFields.has('workOutcome') && (
                  <FieldRow label={t('fields.workOutcome')} value={workOutcomeLabel || null} />
                )}
                {!hiddenFields.has('payoutStatus') && (
                  <FieldRow label={t('fields.payoutStatus')} value={payoutStatusLabel || null} />
                )}
                {!hiddenFields.has('paymentStatus') && (
                  <FieldRow label={t('fields.paymentStatus')} value={paymentStatusLabel || null} />
                )}
                <FieldRow label={t('fields.retention')} value={retentionLabel || null} />
              </Stack>
            </Paper>

            {/* 7. Lifecycle timestamps. */}
            <Paper withBorder p="lg" radius="md" shadow="sm">
              <Stack>
                <Title order={4}>{t('candidates:detail.sections.lifecycle', { defaultValue: 'Lifecycle' })}</Title>
                {/* Date-only (2026-07-04): business dates carry no meaningful hour. */}
                {!hiddenFields.has('documentsSubmittedAt') && (
                  <FieldRow label={t('fields.documentsSubmittedAt')} value={c.documentsSubmittedAt ? new Date(c.documentsSubmittedAt).toLocaleDateString() : null} />
                )}
                <FieldRow label={t('fields.arrivedAt')} value={c.arrivedAt ? new Date(c.arrivedAt).toLocaleDateString() : null} />
                <FieldRow label={t('fields.createdAt')} value={new Date(c.createdAt).toLocaleString()} />
                <FieldRow label={t('fields.updatedAt')} value={new Date(c.updatedAt).toLocaleString()} />
                {c.anonymizedAt && (
                  <FieldRow label={t('fields.anonymizedAt')} value={new Date(c.anonymizedAt).toLocaleString()} />
                )}
              </Stack>
            </Paper>

            {/* 2026-06-13: removed two card sections per product feedback —
                "Система" (processingRestricted + consentId) was noise on
                the detail page (those fields are still in the DB and the
                RODO export, just not surfaced here), and "Historia zmian"
                (CandidateAuditSection) was hidden behind the admin gate
                anyway and added a lot of scroll. The CandidateAuditSection
                function itself is kept in this file for now — easy to wire
                back if we add a dedicated admin "Audit" tab later. */}

            {/* Comments — kept embedded so coordinators can read/write
                without switching tabs. Same component as the dedicated
                Коментарі tab; TanStack Query keeps both in sync. */}
            <CandidateComments candidateId={c.id} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="dismissals" pt="md">
          <DismissalsTab candidateId={c.id} />
        </Tabs.Panel>

        <Tabs.Panel value="comments" pt="md">
          <CandidateComments candidateId={c.id} />
        </Tabs.Panel>

        <Tabs.Panel value="tasks" pt="md">
          <CandidateTasksTab candidateId={c.id} />
        </Tabs.Panel>

      </Tabs>
    </Container>
  );
}

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: candidate, isPending } = useCandidate(id);

  if (isPending || !candidate) return <Splash />;
  return <CandidateDetailInner candidate={candidate} />;
}
