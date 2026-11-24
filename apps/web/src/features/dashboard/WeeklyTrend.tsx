import { Card, Text, Title, Stack } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { WeeklyTrendItem } from '@crm/shared';
import {
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_AXIS_FONT_SIZE,
  tooltipStyle,
  tooltipLabelStyle,
  tooltipItemStyle,
} from './chart-theme';

interface WeeklyTrendProps {
  data: WeeklyTrendItem[];
}

export function WeeklyTrend({ data }: WeeklyTrendProps) {
  const { t } = useTranslation('dashboard');

  if (data.length === 0) {
    return (
      <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('trend.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('funnel.empty')}
          </Text>
        </Stack>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    label: d.date.slice(5),
  }));

  return (
    <Card withBorder radius="md" padding="lg" shadow="sm" data-reveal>
      <Stack gap="xs">
        <Title order={4}>{t('trend.title')}</Title>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={CHART_AXIS_COLOR}
              tick={{ fontSize: CHART_AXIS_FONT_SIZE, fill: CHART_AXIS_COLOR }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke={CHART_AXIS_COLOR}
              tick={{ fontSize: CHART_AXIS_FONT_SIZE, fill: CHART_AXIS_COLOR }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
            />
            <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={8} />
            <Line
              type="monotone"
              dataKey="candidates"
              stroke="#4dabf7"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              name={t('trend.candidates')}
            />
          </LineChart>
        </ResponsiveContainer>
      </Stack>
    </Card>
  );
}
