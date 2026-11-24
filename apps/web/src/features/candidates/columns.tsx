import { ActionIcon, Badge, Box, Group, Text, Tooltip } from '@mantine/core';
import { Copy, Mail, MessageSquare, ShieldCheck } from 'lucide-react';
import type { Candidate, CandidateStatus, UpdateCandidateInput } from '@opushr/shared';
import { CANDIDATE_STATUSES } from '@opushr/shared';
import type { TFunction } from 'i18next';
import { InlineSelectCell } from './InlineSelectCell';

const fmtDate = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString() : '—';
const fullName = (first?: string | null, last?: string | null): string =>
  `${first ?? ''} ${last ?? ''}`.trim() || '—';

// Strip time portion from values that look like a postgres timestamp/ISO date.
// Pattern matches "YYYY-MM-DD[ T]HH:MM:SS(.fff)?(Z|±HH:MM)?" exactly at start.
// Returns DD.MM.YYYY for matches, raw string otherwise — so user-typed
// free text like "Q1 2026" or "Lipiec" passes through untouched.
function formatMaybeDateText(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return v;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// Days between workStartDate and workEndDate/now. 2026-06-10 — switched from
// months to days per product feedback («need to be in days not monthes»).
// 2026-07-04 — calendar-day difference, time-of-day ignored: legacy rows carry
// arbitrary hours while new rows are saved at midnight, and mixing the two
// made the counter drift by ±1. Math.round absorbs DST-shortened days.
function retentionDays(workStartDate: string | null | undefined, workEndDate: string | null | undefined): number | null {
  if (!workStartDate) return null;
  const startRaw = new Date(workStartDate);
  if (Number.isNaN(startRaw.getTime())) return null;
  const endRaw = workEndDate ? new Date(workEndDate) : new Date();
  const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate()).getTime();
  const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

// Map a legacy bucket code (≈119 rows from earlier backfill) to an approximate
// integer of days so the display stays uniform — we show days everywhere now.
const BUCKET_MIN_DAYS: Record<string, number> = {
  under_month: 0,
  month_plus: 30,
  two_months_plus: 60,
  three_months_plus: 90,
  six_months_plus: 180,
  eleven_months_plus: 330,
};

// Slavic plural endings for «день» — used to format the retention label.
function daysLabel(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} днів`;
  if (last === 1) return `${n} день`;
  if (last >= 2 && last <= 4) return `${n} дні`;
  return `${n} днів`;
}

// Slavic plural endings for «коментар»: 1 → коментар, 2–4 → коментарі, 5+ → коментарів.
// Teens (11–14) always take the genitive plural form.
function commentsLabel(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} коментарів`;
  if (last === 1) return `${n} коментар`;
  if (last >= 2 && last <= 4) return `${n} коментарі`;
  return `${n} коментарів`;
}

const STATUS_COLORS: Record<CandidateStatus, string> = {
  new: 'gray',
  in_progress: 'blue',
  documents_submitted: 'cyan',
  cancelled: 'orange',
  employed: 'green',
  re_employed: 'green',
  dismissed: 'red',
  blacklist: 'dark',
};

interface ColumnOptions {
  onShowDuplicates?: (candidate: Candidate) => void;
  duplicatesLabel?: string;
  // Optional map of source code → localized label, fed by useStatusLookup('sources').
  // When a candidate has a source code that's not in this map (e.g. the lookup
  // was soft-deleted), the raw code is shown in italics + dimmed so the row
  // stays readable instead of breaking with t() interpolation noise.
  sourceLabels?: Map<string, string>;
  // Optional map of status code → localized label, fed by useStatusLookup('candidate_status').
  // Falls back to t('status.${code}') when not in the map — keeps backward-compat
  // with i18n labels for codes the lookup hasn't been populated with yet.
  statusLabels?: Map<string, string>;
  // 2026-06-10 Excel-import columns. Same fallback pattern as sourceLabels —
  // unknown code = italics + dimmed raw code.
  positionLabels?: Map<string, string>;
  legalStatusLabels?: Map<string, string>;
  // 2026-06-10 Block 7 reconciliation lookups — same fallback pattern.
  workOutcomeLabels?: Map<string, string>;
  payoutStatusLabels?: Map<string, string>;
  paymentStatusLabels?: Map<string, string>;
  retentionLabels?: Map<string, string>;
  // Maps a `work_end_reason` code (employee_resigned, absenteeism, …) to its
  // localized label from the `dismissal_reason` lookup so the list cell shows
  // "Працівник звільнився" not "employee_resigned".
  dismissalReasonLabels?: Map<string, string>;
  // Inline-edit callback. Receives the candidate + a partial patch. Wired by
  // the list page to a useUpdateCandidate mutation. Omit for read-only tables.
  onInlineUpdate?: (candidate: Candidate, patch: UpdateCandidateInput) => void;
}

// 2026-06-10 — кольорові блоки в DataTable. Тонкий фон на заголовку + клітинках
// допомагає очима стрибати між групами. Інтенсивність низька (~0.06) щоб не
// конкурувати з вмістом badges.
// 2026-07-08 — доданий блок `summary`: 6 ключових колонок одразу після імені
// (Проєкт → Дата подачі документів → Статус → дати роботи → причина закінчення).
// Фіолетовий, щоб відрізнявся від сусіднього синього (ім'я) та інших блоків.
const BLOCK_TINT = {
  name:     { background: 'rgba(34, 139, 230, 0.06)' },      // blue — ім'я
  summary:  { background: 'rgba(112, 72, 232, 0.07)' },      // violet — ключові
  personal: { background: 'rgba(34, 139, 230, 0.06)' },      // blue — особисті
  work:     { background: 'rgba(64, 192, 87, 0.07)' },        // green — робота
  rest:     { background: 'rgba(250, 176, 5, 0.05)' },        // amber — решта
} as const;

// Header tints are layered over an opaque theme background (gradient trick):
// the frozen header (useExcelStickyHeader) floats over rows, and a bare rgba
// background would let row content shine through. Same rendered color as the
// plain rgba in both light and dark schemes.
const HEADER_TINT = {
  name: {
    background:
      'linear-gradient(rgba(34, 139, 230, 0.14), rgba(34, 139, 230, 0.14)) var(--mantine-color-body)',
    fontWeight: 600,
  },
  summary: {
    background:
      'linear-gradient(rgba(112, 72, 232, 0.16), rgba(112, 72, 232, 0.16)) var(--mantine-color-body)',
    fontWeight: 600,
  },
  personal: {
    background:
      'linear-gradient(rgba(34, 139, 230, 0.14), rgba(34, 139, 230, 0.14)) var(--mantine-color-body)',
    fontWeight: 600,
  },
  work: {
    background:
      'linear-gradient(rgba(64, 192, 87, 0.16), rgba(64, 192, 87, 0.16)) var(--mantine-color-body)',
    fontWeight: 600,
  },
  rest: {
    background:
      'linear-gradient(rgba(250, 176, 5, 0.12), rgba(250, 176, 5, 0.12)) var(--mantine-color-body)',
    fontWeight: 600,
  },
} as const;

function tint<T extends object>(block: keyof typeof BLOCK_TINT, col: T): T {
  return {
    ...col,
    cellsStyle: () => BLOCK_TINT[block],
    titleStyle: HEADER_TINT[block],
  };
}

export function buildColumns(t: TFunction<'candidates'>, opts: ColumnOptions = {}) {
  const statusLabel = (code: string) =>
    opts.statusLabels?.get(code) ?? t(`status.${code}`, { defaultValue: code });
  const statusOptions = CANDIDATE_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s),
  }));
  const housingOptions = [
    { value: 'own', label: t('housing.own') },
    { value: 'our', label: t('housing.our') },
  ];

  return [
    // ─────────────────────────── BLOCK 1 — Ім'я (blue) ───────────────────────────
    tint('name', {
      accessor: 'lastName',
      title: t('fields.fullName'),
      width: 220,
      ellipsis: true,
      render: (c: Candidate) => (
        <strong
          style={
            c.hasDuplicate
              ? {
                  background: 'rgba(245, 159, 0, 0.22)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  display: 'inline-block',
                }
              : undefined
          }
          title={c.hasDuplicate ? t('list.duplicateTooltip') : undefined}
        >
          {c.name}
        </strong>
      ),
    }),

    // ─────────────────────────── BLOCK 2 — Ключові (violet) ───────────────────────────
    // 2026-07-08 — на прохання клієнта 6 ключових колонок стоять одразу після
    // імені у фіксованому порядку: Проєкт → Статус документів (легалізація) →
    // Статус → Дата початку роботи → Дата закінчення роботи → Причина закінчення.
    // «Статус документів» = поле legalStatus (UA-підпис саме «Статус документів»),
    // а не дата подачі — та повернена в блок «Решта».
    tint('summary', {
      accessor: 'projectName',
      title: t('fields.project'),
      width: 170,
      ellipsis: true,
      render: (c: Candidate) => c.projectName ?? '—',
    }),
    tint('summary', {
      accessor: 'legalStatus',
      title: t('fields.legalStatus'),
      width: 150,
      ellipsis: true,
      render: (c: Candidate) => {
        if (!c.legalStatus) return '—';
        const dynamic = opts.legalStatusLabels?.get(c.legalStatus);
        if (dynamic) return dynamic;
        return (
          <span style={{ fontStyle: 'italic', color: 'var(--mantine-color-dimmed)' }}>
            {c.legalStatus}
          </span>
        );
      },
    }),
    tint('summary', {
      accessor: 'status',
      title: t('fields.status'),
      width: 180,
      render: (c: Candidate) => {
        const display = (v: string | null) => (
          <Badge color={STATUS_COLORS[(v ?? c.status) as CandidateStatus]} variant="light">
            {statusLabel(v ?? c.status)}
          </Badge>
        );
        if (!opts.onInlineUpdate) return display(c.status);
        return (
          <InlineSelectCell
            value={c.status}
            options={statusOptions}
            clearable={false}
            onSave={(v) => v && opts.onInlineUpdate?.(c, { status: v as CandidateStatus })}
            renderDisplay={display}
          />
        );
      },
    }),
    tint('summary', {
      accessor: 'workStartDate',
      title: t('fields.workStartDate'),
      width: 140,
      render: (c: Candidate) =>
        c.workStartDate ? new Date(c.workStartDate).toLocaleDateString() : '—',
    }),
    tint('summary', {
      accessor: 'workEndDate',
      title: t('fields.workEndDate'),
      width: 140,
      render: (c: Candidate) =>
        c.workEndDate ? new Date(c.workEndDate).toLocaleDateString() : '—',
    }),
    tint('summary', {
      accessor: 'workEndReason',
      title: t('fields.workEndReason'),
      width: 180,
      ellipsis: true,
      render: (c: Candidate) => {
        if (!c.workEndReason) return '—';
        const dynamic = opts.dismissalReasonLabels?.get(c.workEndReason);
        if (dynamic) return dynamic;
        return (
          <span style={{ fontStyle: 'italic', color: 'var(--mantine-color-dimmed)' }}>
            {c.workEndReason}
          </span>
        );
      },
    }),

    // ─────────────────────────── BLOCK 3 — Особисті (blue) ───────────────────────────
    tint('personal', { accessor: 'email', title: t('fields.email'), width: 240, ellipsis: true }),
    tint('personal', { accessor: 'phone', title: t('fields.phone'), width: 150 }),
    // 2026-07-14 — compact marketing-consent indicator: two icons (email + SMS),
    // green when an active consent exists, dimmed when not. Subtle by design —
    // full status + record actions live on the detail card.
    tint('personal', {
      accessor: 'consent',
      title: t('fields.consent', { defaultValue: 'Згода' }),
      width: 110,
      textAlign: 'center' as const,
      render: (c: Candidate) => {
        const rodoOn = c.rodoConsent ?? false;
        const emailOn = c.emailConsent ?? false;
        const smsOn = c.smsConsent ?? false;
        const onColor = 'var(--mantine-color-green-6)';
        const offColor = 'var(--mantine-color-gray-5)';
        // RODO first — the obligatory processing basis (red when missing);
        // Email / SMS are the marketing-channel consents.
        return (
          <Group gap={8} justify="center" wrap="nowrap">
            <Tooltip label={rodoOn ? t('consent.rodoOn') : t('consent.rodoOff')} withArrow>
              <Box component="span" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <ShieldCheck
                  size={15}
                  color={rodoOn ? onColor : 'var(--mantine-color-red-6)'}
                />
              </Box>
            </Tooltip>
            <Tooltip label={emailOn ? t('consent.emailOn') : t('consent.emailOff')} withArrow>
              <Box component="span" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <Mail size={15} color={emailOn ? onColor : offColor} />
              </Box>
            </Tooltip>
            <Tooltip label={smsOn ? t('consent.smsOn') : t('consent.smsOff')} withArrow>
              <Box component="span" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <MessageSquare size={15} color={smsOn ? onColor : offColor} />
              </Box>
            </Tooltip>
          </Group>
        );
      },
    }),
    // 2026-06-12 — free-text messenger contact. Hidden by default on
    // /candidates (see defaultHiddenForKind in CandidateList).
    tint('personal', {
      accessor: 'messenger',
      title: t('fields.messenger'),
      width: 180,
      ellipsis: true,
      render: (c: Candidate) =>
        c.messenger ? (
          <Tooltip label={c.messenger} multiline w={260}>
            <Text size="sm" truncate>{c.messenger}</Text>
          </Tooltip>
        ) : (
          '—'
        ),
    }),
    // 2026-06-12 — free-text work history. Hidden by default (long text
    // would balloon the row); detail page renders it in full.
    tint('personal', {
      accessor: 'experience',
      title: t('fields.experience'),
      width: 220,
      ellipsis: true,
      render: (c: Candidate) =>
        c.experience ? (
          <Tooltip label={c.experience} multiline w={360}>
            <Text size="sm" truncate>{c.experience}</Text>
          </Tooltip>
        ) : (
          '—'
        ),
    }),
    tint('personal', {
      accessor: 'birthDate',
      title: t('fields.birthDate'),
      width: 130,
      render: (c: Candidate) => (c.birthDate ? new Date(c.birthDate).toLocaleDateString() : '—'),
    }),
    tint('personal', {
      accessor: 'nationality',
      title: t('fields.nationality'),
      width: 140,
      render: (c: Candidate) => c.nationality ?? '—',
    }),

    // ─────────────────────────── BLOCK 4 — Робота (green) ────────────────────────────
    tint('work', {
      accessor: 'retention',
      title: t('fields.retention'),
      width: 150,
      render: (c: Candidate) => {
        if (c.retention === 'off_target') {
          const label = opts.retentionLabels?.get('off_target') ?? 'Нецільовий';
          return <Badge variant="light" color="red">{label}</Badge>;
        }
        const days = retentionDays(c.workStartDate, c.workEndDate);
        if (days !== null) {
          const isComputed = !c.retention;
          return (
            <Badge
              variant={isComputed ? 'outline' : 'light'}
              color="grape"
              style={isComputed ? { fontStyle: 'italic', opacity: 0.75 } : undefined}
            >
              {daysLabel(days)}
            </Badge>
          );
        }
        if (c.retention && BUCKET_MIN_DAYS[c.retention] !== undefined) {
          const d = BUCKET_MIN_DAYS[c.retention]!;
          return <Badge variant="light" color="grape">{`${daysLabel(d)}+`}</Badge>;
        }
        return '—';
      },
    }),
    tint('work', {
      accessor: 'workOutcome',
      title: t('fields.workOutcome'),
      width: 160,
      render: (c: Candidate) => {
        if (!c.workOutcome) return '—';
        const label = opts.workOutcomeLabels?.get(c.workOutcome) ?? c.workOutcome;
        const color = c.workOutcome === 'worked' ? 'teal' : 'blue';
        return <Badge variant="light" color={color}>{label}</Badge>;
      },
    }),
    tint('work', {
      accessor: 'reasonNote',
      title: t('fields.reasonNote'),
      width: 200,
      ellipsis: true,
      render: (c: Candidate) =>
        c.reasonNote ? <Tooltip label={c.reasonNote} multiline w={320}><Text size="sm" truncate>{c.reasonNote}</Text></Tooltip> : '—',
    }),

    // ─────────────────────────── BLOCK 5 — Решта (amber) ─────────────────────────────
    tint('rest', {
      accessor: 'source',
      title: t('fields.source'),
      width: 130,
      render: (c: Candidate) => {
        if (!c.source) return '—';
        const dynamic = opts.sourceLabels?.get(c.source);
        if (dynamic) return dynamic;
        return (
          <span style={{ fontStyle: 'italic', color: 'var(--mantine-color-dimmed)' }}>
            {c.source}
          </span>
        );
      },
    }),
    tint('rest', {
      accessor: 'position',
      title: t('fields.position'),
      width: 150,
      ellipsis: true,
      render: (c: Candidate) => {
        if (!c.position) return '—';
        const dynamic = opts.positionLabels?.get(c.position);
        if (dynamic) return dynamic;
        return (
          <span style={{ fontStyle: 'italic', color: 'var(--mantine-color-dimmed)' }}>
            {c.position}
          </span>
        );
      },
    }),
    tint('rest', {
      accessor: 'reconciliationPeriod',
      title: t('fields.reconciliationPeriod'),
      width: 170,
      ellipsis: true,
      render: (c: Candidate) => (c.reconciliationPeriod ? formatMaybeDateText(c.reconciliationPeriod) : '—'),
    }),
    tint('rest', {
      accessor: 'payoutStatus',
      title: t('fields.payoutStatus'),
      width: 180,
      render: (c: Candidate) => {
        if (!c.payoutStatus) return '—';
        const label = opts.payoutStatusLabels?.get(c.payoutStatus) ?? c.payoutStatus;
        const color =
          c.payoutStatus === 'payable' ? 'green'
          : c.payoutStatus === 'internal_recruitment' ? 'yellow'
          : c.payoutStatus === 'term_not_served' ? 'red'
          : 'gray';
        return <Badge variant="light" color={color}>{label}</Badge>;
      },
    }),
    tint('rest', {
      accessor: 'paymentStatus',
      title: t('fields.paymentStatus'),
      width: 160,
      render: (c: Candidate) => {
        if (!c.paymentStatus) return '—';
        const label = opts.paymentStatusLabels?.get(c.paymentStatus) ?? c.paymentStatus;
        const color =
          c.paymentStatus === 'paid' ? 'green'
          : c.paymentStatus === 'invoice_pending' ? 'blue'
          : 'gray';
        return <Badge variant="light" color={color}>{label}</Badge>;
      },
    }),
    tint('rest', {
      accessor: 'housingType',
      title: t('fields.housing', { defaultValue: 'Mieszkanie' }),
      width: 100,
      render: (c: Candidate) => {
        const display = (v: string | null) =>
          v ? (
            <Badge variant="light" color={v === 'our' ? 'teal' : 'blue'}>
              {t(`housing.${v}`)}
            </Badge>
          ) : (
            <Text c="dimmed">—</Text>
          );
        if (!opts.onInlineUpdate) return display(c.housingType ?? null);
        return (
          <InlineSelectCell
            value={c.housingType ?? null}
            options={housingOptions}
            onSave={(v) => opts.onInlineUpdate?.(c, { housingType: (v as 'own' | 'our' | null) ?? null })}
            renderDisplay={display}
          />
        );
      },
    }),
    tint('rest', {
      accessor: 'recruiterName',
      title: t('fields.recruiter'),
      width: 160,
      ellipsis: true,
      render: (c: Candidate) => fullName(c.recruiterFirstName, c.recruiterLastName),
    }),
    tint('rest', {
      accessor: 'coordinatorName',
      title: t('fields.coordinator'),
      width: 160,
      ellipsis: true,
      render: (c: Candidate) => fullName(c.coordinatorFirstName, c.coordinatorLastName),
    }),
    // 2026-06-11 — column repurposed: instead of joining the legacy
    // `freelancers` table by `candidates.freelancer_id`, derive the badge from
    // the assigned recruiter's `users.is_freelancer` flag. Recruiter name is
    // unchanged in its own column above; the legacy freelancer_id FK + table
    // are intentionally left intact for now (no migration).
    tint('rest', {
      accessor: 'recruiterType',
      title: t('detail.fields.freelancer', { defaultValue: 'Фрілансер' }),
      width: 120,
      render: (c: Candidate) => {
        if (c.recruiterId == null || c.recruiterIsFreelancer == null) {
          return '—';
        }
        return c.recruiterIsFreelancer ? (
          <Badge color="orange" variant="light">
            {t('recruiterType.freelance', { defaultValue: 'Фрілансер' })}
          </Badge>
        ) : (
          <Badge color="gray" variant="light">
            {t('recruiterType.staff', { defaultValue: 'Наш' })}
          </Badge>
        );
      },
    }),
    tint('rest', {
      accessor: 'documentsSubmittedAt',
      title: t('fields.documentsSubmittedAt'),
      width: 150,
      render: (c: Candidate) => fmtDate(c.documentsSubmittedAt),
    }),
    tint('rest', {
      accessor: 'arrivedAt',
      title: t('fields.arrivedAt'),
      width: 140,
      render: (c: Candidate) => fmtDate(c.arrivedAt),
    }),
    tint('rest', {
      accessor: 'comments',
      title: t('fields.comments', { defaultValue: 'Коментарі' }),
      width: 280,
      ellipsis: true,
      render: (c: Candidate) => {
        const n = c.commentsCount ?? 0;
        if (n === 0) return <Text c="dimmed">—</Text>;
        const preview = c.lastCommentBody?.trim() ?? '';
        const tooltipLabel = preview
          ? `${commentsLabel(n)}\n\n${preview}`
          : commentsLabel(n);
        return (
          <Tooltip label={tooltipLabel} multiline w={360} withArrow>
            <Group gap={6} wrap="nowrap" align="center">
              <MessageSquare size={14} style={{ flexShrink: 0 }} />
              <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>{n}</Text>
              {preview && (
                <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {preview}
                </Text>
              )}
            </Group>
          </Tooltip>
        );
      },
    }),
    tint('rest', {
      accessor: 'createdAt',
      title: t('fields.createdAt'),
      width: 180,
      render: (c: Candidate) => new Date(c.createdAt).toLocaleString(),
    }),
    tint('rest', {
      accessor: 'dupActions',
      title: t('list.duplicateColumn'),
      width: 90,
      textAlign: 'center' as const,
      render: (c: Candidate) =>
        c.hasDuplicate && opts.onShowDuplicates ? (
          <Tooltip label={opts.duplicatesLabel ?? 'Duplikaty'}>
            <ActionIcon
              variant="subtle"
              color="orange"
              onClick={(e) => {
                e.stopPropagation();
                opts.onShowDuplicates?.(c);
              }}
            >
              <Copy size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null,
    }),
  ];
}

export { STATUS_COLORS };
