import { Divider, Grid, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { PeriodStats as PeriodStatsData } from '@crm/shared';
import { KpiTile } from './KpiTile';

interface Props {
  data: PeriodStatsData;
}

// Workforce metrics for the selected range (client request 2026-07-08).
// Counts come from employment_periods so re-hires count as separate episodes.
export function PeriodStats({ data }: Props) {
  const { t } = useTranslation('dashboard');
  const days = t('periodStats.days');
  const fmtDays = (v: number | null): string =>
    v === null ? t('periodStats.none') : `${v.toFixed(1)} ${days}`;

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="md">
        <Stack gap={2}>
          <Title order={4}>{t('periodStats.title')}</Title>
          <Text c="dimmed" size="xs">{t('periodStats.hint')}</Text>
        </Stack>

        <Grid>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <KpiTile title={t('periodStats.employed')} value={data.employedInPeriod} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <KpiTile title={t('periodStats.finished')} value={data.finishedInPeriod} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <KpiTile title={t('periodStats.working')} value={data.workingAsOf} />
          </Grid.Col>
        </Grid>

        <Divider />

        <Group grow align="flex-start" wrap="wrap">
          <Stat label={t('periodStats.avgDaysFinished')} value={fmtDays(data.avgDaysFinished)} />
          <Stat label={t('periodStats.avgDaysWorking')} value={fmtDays(data.avgDaysWorking)} />
          <Stat
            label={t('periodStats.totalDays')}
            value={`${data.totalDaysInPeriod.toFixed(0)} ${days}`}
          />
        </Group>
      </Stack>
    </Paper>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={2} miw={160}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.4}>
        {label}
      </Text>
      <Text fz={22} fw={700} lh={1.2}>
        {value}
      </Text>
    </Stack>
  );
}
