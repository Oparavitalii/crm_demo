import { Card, Stack, Text, Title } from '@mantine/core';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { StatusFunnelItem } from '@opushr/shared';
import { percentOf } from '@/lib/format';
import {
  CHART_AXIS_COLOR,
  CHART_AXIS_FONT_SIZE,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from './chart-theme';
import { LegendItem } from './LegendItem';

const STATUS_COLORS: Record<string, string> = {
  new: '#4dabf7',
  in_progress: '#74c0fc',
  awaiting_invite: '#f9c74f',
  housed: '#90be6d',
  working: '#43aa8b',
  dismissed: '#f94144',
};

interface StatusFunnelProps {
  data: StatusFunnelItem[];
}

export function StatusFunnel({ data }: StatusFunnelProps) {
  const { t } = useTranslation(['dashboard', 'candidates']);

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('funnel.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('funnel.empty')}
          </Text>
        </Stack>
      </Card>
    );
  }

  const translated = data.map((d) => ({
    ...d,
    label: t(`candidates:status.${d.status}`),
    color: STATUS_COLORS[d.status] ?? '#868e96',
  }));

  const total = translated.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
      <Stack gap="sm">
        <Title order={4}>{t('funnel.title')}</Title>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={translated}
            margin={{ top: 24, right: 8, left: 8, bottom: 28 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              stroke="rgba(148, 163, 184, 0.35)"
              strokeDasharray="3 4"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              interval={0}
              stroke={CHART_AXIS_COLOR}
              tick={{ fontSize: CHART_AXIS_FONT_SIZE, fill: CHART_AXIS_COLOR }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              stroke={CHART_AXIS_COLOR}
              tick={{ fontSize: CHART_AXIS_FONT_SIZE, fill: CHART_AXIS_COLOR }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
              formatter={(value: number) => [`${value} (${percentOf(value, total)}%)`, t('funnel.title')]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {translated.map((entry) => (
                <Cell key={entry.status} fill={entry.color} />
              ))}
              <LabelList
                dataKey="count"
                position="top"
                fill={CHART_AXIS_COLOR}
                fontSize={CHART_AXIS_FONT_SIZE}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <Stack gap={6}>
          {translated.map((d) => (
            <LegendItem
              key={d.status}
              color={d.color}
              label={d.label}
              value={d.count}
              percent={percentOf(d.count, total)}
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
