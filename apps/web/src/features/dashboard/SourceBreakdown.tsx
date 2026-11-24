import { Card, Stack, Text, Title } from '@mantine/core';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from 'react-i18next';
import type { SourceBreakdownItem } from '@crm/shared';
import { percentOf } from '@/lib/format';
import { tooltipStyle, tooltipLabelStyle, tooltipItemStyle } from './chart-theme';
import { LegendItem } from './LegendItem';
import { useStatusLookup, pickLabel } from '@/features/admin-statuses/useStatusLookup';

const SOURCE_COLORS = ['#4dabf7', '#f9c74f', '#90be6d', '#f94144', '#a78bfa', '#868e96'];

interface SourceBreakdownProps {
  data: SourceBreakdownItem[];
}

export function SourceBreakdown({ data }: SourceBreakdownProps) {
  const { t, i18n } = useTranslation(['dashboard', 'candidates']);
  // Source labels come from status_lookups (admin-editable in /admin/settings/statuses)
  // so custom codes like `form_recruiter` or `telegram` render their PL/UA name
  // instead of the raw code. Hardcoded i18n keys are kept as a fallback for the
  // legacy seed codes when a row is missing from the lookup list.
  const { data: sourceLookup } = useStatusLookup('sources');

  const filtered = data.filter((d) => d.count > 0);

  if (filtered.length === 0) {
    return (
      <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('source.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('source.empty')}
          </Text>
        </Stack>
      </Card>
    );
  }

  const unknownLabel = t('source.unknown');
  const labelFor = (code: string | null): string => {
    if (!code) return unknownLabel;
    const { label, missing } = pickLabel(sourceLookup, code, i18n.language);
    // Soft-deleted or never-registered code → bucket as "Unknown" rather than
    // surface the raw code. Per admin request 2026-06-12: deleting a status
    // should make existing references render as Unknown.
    if (missing) return unknownLabel;
    return label;
  };

  // Merge all entries that resolve to the same label (notably all "unknown"
  // sources — nulls + soft-deleted codes — collapse into a single slice).
  const aggregated = new Map<string, number>();
  for (const d of filtered) {
    const name = labelFor(d.source);
    aggregated.set(name, (aggregated.get(name) ?? 0) + d.count);
  }
  const chartData: { name: string; value: number; color: string }[] = [...aggregated.entries()].map(
    ([name, value], i) => ({
      name,
      value,
      color: SOURCE_COLORS[i % SOURCE_COLORS.length] ?? '#868e96',
    }),
  );

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
      <Stack gap="sm">
        <Title order={4}>{t('source.title')}</Title>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={80}
              paddingAngle={1}
              stroke="none"
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={(value: number, name: string) => [`${value} (${percentOf(value, total)}%)`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <Stack gap={6}>
          {chartData.map((d) => (
            <LegendItem
              key={d.name}
              color={d.color}
              label={d.name}
              value={d.value}
              percent={percentOf(d.value, total)}
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
