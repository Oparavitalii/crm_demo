import type { JSX } from 'react';
import { Badge, Checkbox, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { CalendarDays, FileText, Mail, MessageSquare, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Candidate } from '@opushr/shared';

interface Props {
  items: Candidate[];
  isLoading: boolean;
  sourceLabels?: Map<string, string>;
  statusLabels?: Map<string, string>;
  // 2026-06-10 Block 7 — coordinator badges shown on the mobile card so the
  // /clients view doesn't look empty on narrow viewports.
  workOutcomeLabels?: Map<string, string>;
  payoutStatusLabels?: Map<string, string>;
  paymentStatusLabels?: Map<string, string>;
  retentionLabels?: Map<string, string>;
  // 2026-07-08 — accessors the current role must not see (roleFieldVisibility).
  // Gates the source line and the workOutcome/payoutStatus/paymentStatus badges.
  hiddenFields?: ReadonlySet<string>;
  // 2026-06-12 Multi-select on mobile so BulkActionsBar fires on phones too.
  // When `selected` contains at least one row, tapping a card toggles
  // selection instead of navigating; the leading checkbox always toggles.
  // Optional — if not provided, cards behave exactly as before.
  selected?: Candidate[];
  onSelectedChange?: (items: Candidate[]) => void;
}

function statusColor(s: string): string {
  if (s === 'employed' || s === 're_employed') return 'green';
  if (s === 'dismissed') return 'orange';
  if (s === 'cancelled' || s === 'blacklist') return 'red';
  if (s === 'new') return 'blue';
  return 'gray';
}

// Retention in integer days — matches columns.tsx so mobile/desktop render
// the same value. 2026-06-10: switched from months to days per product feedback.
// 2026-07-04 — calendar-day difference, time-of-day ignored (see columns.tsx).
function retentionDays(workStartDate: string | null | undefined, workEndDate: string | null | undefined): number | null {
  if (!workStartDate) return null;
  const startRaw = new Date(workStartDate);
  if (Number.isNaN(startRaw.getTime())) return null;
  const endRaw = workEndDate ? new Date(workEndDate) : new Date();
  const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate()).getTime();
  const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const BUCKET_MIN_DAYS: Record<string, number> = {
  under_month: 0, month_plus: 30, two_months_plus: 60,
  three_months_plus: 90, six_months_plus: 180, eleven_months_plus: 330,
};

function daysLabel(n: number): string {
  const lastTwo = n % 100, last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} днів`;
  if (last === 1) return `${n} день`;
  if (last >= 2 && last <= 4) return `${n} дні`;
  return `${n} днів`;
}

export function MobileCandidateCardList(props: Props): JSX.Element {
  const { items, isLoading, sourceLabels, statusLabels,
    workOutcomeLabels, payoutStatusLabels, paymentStatusLabels, retentionLabels,
    hiddenFields, selected, onSelectedChange } = props;
  const { t } = useTranslation('candidates');
  const navigate = useNavigate();

  const selectionEnabled = selected !== undefined && onSelectedChange !== undefined;
  const selectedIds = new Set((selected ?? []).map((c) => c.id));
  const hasSelection = selectedIds.size > 0;

  const toggleSelect = (c: Candidate) => {
    if (!onSelectedChange) return;
    const list = selected ?? [];
    if (selectedIds.has(c.id)) {
      onSelectedChange(list.filter((x) => x.id !== c.id));
    } else {
      onSelectedChange([...list, c]);
    }
  };

  if (isLoading) {
    return (
      <Stack gap="sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} h={72} radius="md" />
        ))}
      </Stack>
    );
  }

  if (items.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        {t('list.empty', { defaultValue: '—' })}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {items.map((c) => {
        const isSelected = selectedIds.has(c.id);
        const showWorkOutcome = Boolean(c.workOutcome) && !hiddenFields?.has('workOutcome');
        const showPayoutStatus = Boolean(c.payoutStatus) && !hiddenFields?.has('payoutStatus');
        const showPaymentStatus = Boolean(c.paymentStatus) && !hiddenFields?.has('paymentStatus');
        const handleCardClick = () => {
          // When at least one row is already selected, tapping anywhere on the
          // card toggles selection instead of navigating — matches the typical
          // mobile "selection mode" pattern users know from Gmail/Files apps.
          if (selectionEnabled && hasSelection) {
            toggleSelect(c);
            return;
          }
          navigate(`/candidates/${c.id}`);
        };
        return (
          <UnstyledButton
            key={c.id}
            onClick={handleCardClick}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <Paper
              withBorder
              radius="md"
              p="sm"
              style={
                isSelected
                  ? {
                      borderColor: 'var(--mantine-color-brand-6)',
                      backgroundColor: 'var(--mantine-color-brand-light)',
                    }
                  : undefined
              }
            >
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                    {selectionEnabled && (
                      <Checkbox
                        size="sm"
                        checked={isSelected}
                        onChange={() => toggleSelect(c)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t('list.selectRow', { defaultValue: 'Zaznacz wiersz' })}
                      />
                    )}
                    <Text fw={600} size="sm" truncate>
                      {c.name}
                    </Text>
                  </Group>
                  <Badge size="sm" variant="light" color={statusColor(c.status)}>
                    {statusLabels?.get(c.status) ?? c.status}
                  </Badge>
                </Group>
                <Group gap="md" wrap="wrap">
                  {c.source && !hiddenFields?.has('source') && (
                    <Text size="xs" c="dimmed">
                      {sourceLabels?.get(c.source) ?? c.source}
                    </Text>
                  )}
                  {c.email && (
                    <Group gap={4}>
                      <Mail size={12} />
                      <Text size="xs" c="dimmed" truncate maw={140}>
                        {c.email}
                      </Text>
                    </Group>
                  )}
                  {c.phone && (
                    <Group gap={4}>
                      <Phone size={12} />
                      <Text size="xs" c="dimmed">
                        {c.phone}
                      </Text>
                    </Group>
                  )}
                  {(c.commentsCount ?? 0) > 0 && (
                    <Group gap={4}>
                      <MessageSquare size={12} />
                      <Text size="xs" c="dimmed">{c.commentsCount}</Text>
                    </Group>
                  )}
                  {c.notes && c.notes.trim() && (
                    <Group gap={4}>
                      <FileText size={12} color="var(--mantine-color-grape-6)" />
                      <Text size="xs" c="dimmed" truncate maw={160}>
                        {c.notes.split('\n')[0]}
                      </Text>
                    </Group>
                  )}
                </Group>
                {/* Block 7 reconciliation row — only render when at least one
                    field is present so cards stay compact for early-pipeline
                    candidates. Retention falls back to computed value when
                    unset (italic outline badge). */}
                {(showWorkOutcome || showPayoutStatus || showPaymentStatus || c.retention || c.workStartDate) && (
                  <Group gap={4} wrap="wrap">
                    {/* 2026-07-06 — work period right on the card: mobile has no
                        "Колонки" popover, so this is the only way phone users see
                        the dates without opening the detail page. */}
                    {c.workStartDate && (
                      <Group gap={4} wrap="nowrap">
                        <CalendarDays size={12} />
                        <Text size="xs" c="dimmed">
                          {new Date(c.workStartDate).toLocaleDateString()}
                          {c.workEndDate ? ` – ${new Date(c.workEndDate).toLocaleDateString()}` : ''}
                        </Text>
                      </Group>
                    )}
                    {showWorkOutcome && c.workOutcome && (
                      <Badge size="xs" variant="light" color={c.workOutcome === 'worked' ? 'teal' : 'blue'}>
                        {workOutcomeLabels?.get(c.workOutcome) ?? c.workOutcome}
                      </Badge>
                    )}
                    {showPayoutStatus && c.payoutStatus && (
                      <Badge size="xs" variant="light"
                        color={c.payoutStatus === 'payable' ? 'green'
                          : c.payoutStatus === 'internal_recruitment' ? 'yellow'
                          : c.payoutStatus === 'term_not_served' ? 'red' : 'gray'}>
                        {payoutStatusLabels?.get(c.payoutStatus) ?? c.payoutStatus}
                      </Badge>
                    )}
                    {showPaymentStatus && c.paymentStatus && (
                      <Badge size="xs" variant="light"
                        color={c.paymentStatus === 'paid' ? 'green'
                          : c.paymentStatus === 'invoice_pending' ? 'blue' : 'gray'}>
                        {paymentStatusLabels?.get(c.paymentStatus) ?? c.paymentStatus}
                      </Badge>
                    )}
                    {(() => {
                      if (c.retention === 'off_target') {
                        const label = retentionLabels?.get('off_target') ?? 'Нецільовий';
                        return <Badge size="xs" variant="light" color="red">{label}</Badge>;
                      }
                      const days = retentionDays(c.workStartDate, c.workEndDate);
                      if (days !== null) {
                        const isComputed = !c.retention;
                        return (
                          <Badge size="xs" variant={isComputed ? 'outline' : 'light'} color="grape"
                            style={isComputed ? { fontStyle: 'italic', opacity: 0.75 } : undefined}>
                            {daysLabel(days)}
                          </Badge>
                        );
                      }
                      if (c.retention && BUCKET_MIN_DAYS[c.retention] !== undefined) {
                        return (
                          <Badge size="xs" variant="light" color="grape">
                            {`${daysLabel(BUCKET_MIN_DAYS[c.retention]!)}+`}
                          </Badge>
                        );
                      }
                      return null;
                    })()}
                  </Group>
                )}
              </Stack>
            </Paper>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
