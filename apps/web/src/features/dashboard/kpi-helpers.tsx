import { Badge, Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { pickLabel, useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

// Shared KPI table helpers used by RecruiterKpiTable + FreelancerKpiTable.
// Kept tiny on purpose — just formatting + the source-badges cell renderer.

export const numCol = { textAlign: 'right' as const };

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

// 2026-07-10 — shared formatters/colors for the unified six-metric workforce
// block (retention tables + recruiter/coordinator KPI tabs). Averages arrive
// rounded to 0.1 from the backend; `??` guards cover the deploy window where
// an older API doesn't send the new fields yet.
export const fmtAvgDays = (v: number | null | undefined): string =>
  v == null ? '—' : v.toFixed(1);
export const fmtTotalDays = (v: number | undefined): string => {
  const n = v ?? 0;
  return n <= 0 ? '—' : n.toFixed(0);
};
export const pct = (rate: number): string => `${(rate * 100).toFixed(0)}%`;
export const rateColor = (rate: number, hasData: boolean): string =>
  !hasData ? 'dimmed' : rate >= 0.8 ? 'green' : rate >= 0.5 ? 'yellow.7' : 'red';

// Average-tenure cell: value + «дн.» unit + the sample size it was computed
// from, in a distinct color (client request 2026-07-10 — «скільки людей ми
// рахували»). Total-days cell gets the unit only.
export function DaysAvgValue({
  value,
  count,
  size = 'sm',
}: {
  value: number | null | undefined;
  count?: number;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation('dashboard');
  if (value == null) return <Text size={size} span>—</Text>;
  return (
    <Text size={size} span style={{ whiteSpace: 'nowrap' }}>
      {value.toFixed(1)} {t('retentionCat.daysShort', { defaultValue: 'дн.' })}
      {count !== undefined && count > 0 && (
        <Text span size="xs" c="blue.5" ml={4}>
          ({count})
        </Text>
      )}
    </Text>
  );
}

export function DaysTotalValue({
  value,
  size = 'sm',
}: {
  value: number | undefined;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation('dashboard');
  const n = value ?? 0;
  if (n <= 0) return <Text size={size} span>—</Text>;
  return (
    <Text size={size} span style={{ whiteSpace: 'nowrap' }}>
      {n.toFixed(0)} {t('retentionCat.daysShort', { defaultValue: 'дн.' })}
    </Text>
  );
}

export function SourceBadges({ sources }: { sources: Record<string, number> }) {
  // Source labels come from status_lookups (admin-editable in /admin/settings/statuses)
  // so codes like `form_recruiter`/`telegram` render their PL/UA name instead of
  // the raw code. Same mechanism as the SourceBreakdown donut.
  const { t, i18n } = useTranslation('dashboard');
  const { data: sourceLookup } = useStatusLookup('sources');

  const entries = Object.entries(sources);
  if (entries.length === 0) {
    return <Text c="dimmed">—</Text>;
  }

  const unknownLabel = t('source.unknown');
  const labelFor = (code: string): string => {
    if (code === 'unknown') return unknownLabel;
    const { label, missing } = pickLabel(sourceLookup, code, i18n.language);
    // Soft-deleted or never-registered code → bucket as "Unknown" instead of
    // surfacing the raw code (per admin request 2026-06-12).
    if (missing) return unknownLabel;
    return label;
  };

  // Aggregate any entries that resolve to the same label (notably all entries
  // bucketed as "Unknown" — null sources + soft-deleted codes — collapse).
  const aggregated = new Map<string, number>();
  for (const [code, count] of entries) {
    const name = labelFor(code);
    aggregated.set(name, (aggregated.get(name) ?? 0) + count);
  }

  return (
    <Group gap="xs" wrap="wrap">
      {[...aggregated.entries()].map(([label, count]) => (
        <Badge key={label} size="xs" variant="light" color="gray">
          {label}: {count}
        </Badge>
      ))}
    </Group>
  );
}
