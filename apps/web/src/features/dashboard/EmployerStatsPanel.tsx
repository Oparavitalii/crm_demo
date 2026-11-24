import { Badge, Grid, Paper, Stack, Table, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { EmployerStats } from '@crm/shared';
import { KpiTile } from './KpiTile';

const STATUS_COLORS: Record<string, string> = {
  new: 'blue',
  contacted: 'cyan',
  accepted: 'green',
  rejected: 'red',
  archived: 'gray',
};

interface Props {
  data: EmployerStats;
}

export function EmployerStatsPanel({ data }: Props) {
  const { t } = useTranslation(['dashboard', 'employers']);
  const acceptancePct = `${(data.acceptanceRate * 100).toFixed(1)}%`;

  return (
    <Stack gap="xl">
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <KpiTile title={t('employerPanel.total')} value={data.total} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <KpiTile title={t('employerPanel.newThisMonth')} value={data.newThisMonth} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <KpiTile title={t('employerPanel.acceptanceRate')} value={acceptancePct} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <KpiTile
            title={t('employerPanel.activePipeline')}
            value={data.byStatus
              .filter((s) => s.status === 'new' || s.status === 'contacted')
              .reduce((sum, s) => sum + s.count, 0)}
          />
        </Grid.Col>
      </Grid>

      <Paper withBorder p="md" radius="md">
        <Stack gap="xs">
          <Title order={4}>{t('employerPanel.byStatusTitle')}</Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('employerPanel.status')}</Table.Th>
                <Table.Th ta="right">{t('employerPanel.count')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.byStatus.map((s) => (
                <Table.Tr key={s.status}>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[s.status] ?? 'gray'} variant="light">
                      {t(`employers:status.${s.status}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">{s.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Paper>
    </Stack>
  );
}
