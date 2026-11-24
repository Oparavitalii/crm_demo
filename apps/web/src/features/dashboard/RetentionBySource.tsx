import { Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { RetentionBySourceItem } from '@opushr/shared';
import { pickLabel, useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

interface Props {
  data: RetentionBySourceItem[];
}

export function RetentionBySource({ data }: Props) {
  const { t, i18n } = useTranslation('dashboard');
  // Source labels come from status_lookups (admin-editable in /admin/settings/
  // statuses) — same mechanism as SourceBreakdown/SourceBadges. Codes missing
  // from the lookup (null source, or a soft-deleted / legacy code like `none`)
  // bucket into "Unknown" instead of surfacing the raw code as a bare key.
  const { data: sourceLookup } = useStatusLookup('sources');

  const unknownLabel = t('retention.unknownSource');
  const labelFor = (code: string | null): string => {
    if (!code) return unknownLabel;
    const { label, missing } = pickLabel(sourceLookup, code, i18n.language);
    return missing ? unknownLabel : label;
  };

  // Aggregate by resolved label so codes that collapse to the same name
  // (notably every "unknown" bucket — null + legacy/soft-deleted codes) merge
  // into one row; recompute the retention rate on the merged totals.
  const aggregated = new Map<string, { workingCount: number; dismissedCount: number }>();
  for (const d of data) {
    if (d.workingCount + d.dismissedCount === 0) continue;
    const name = labelFor(d.source);
    const entry = aggregated.get(name) ?? { workingCount: 0, dismissedCount: 0 };
    entry.workingCount += d.workingCount;
    entry.dismissedCount += d.dismissedCount;
    aggregated.set(name, entry);
  }

  const rows = [...aggregated.entries()]
    .map(([label, v]) => {
      const total = v.workingCount + v.dismissedCount;
      return { label, ...v, retentionRate: total === 0 ? 0 : v.workingCount / total };
    })
    .sort((a, b) => b.workingCount + b.dismissedCount - (a.workingCount + a.dismissedCount));

  if (rows.length === 0) {
    return (
      <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('retention.title')}</Title>
          <Text c="dimmed" size="sm">{t('retention.empty')}</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="xs">
        <Title order={4}>{t('retention.title')}</Title>
        <Text c="dimmed" size="xs">{t('retention.hint')}</Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('retention.source')}</Table.Th>
              <Table.Th ta="right">{t('retention.working')}</Table.Th>
              <Table.Th ta="right">{t('retention.dismissed')}</Table.Th>
              <Table.Th ta="right">{t('retention.rate')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const pct = `${(r.retentionRate * 100).toFixed(0)}%`;
              const color =
                r.retentionRate >= 0.8 ? 'green' : r.retentionRate >= 0.5 ? 'yellow.7' : 'red';
              return (
                <Table.Tr key={r.label}>
                  <Table.Td>{r.label}</Table.Td>
                  <Table.Td ta="right">{r.workingCount}</Table.Td>
                  <Table.Td ta="right">{r.dismissedCount}</Table.Td>
                  <Table.Td ta="right" c={color} fw={600}>{pct}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Stack>
    </Paper>
  );
}
