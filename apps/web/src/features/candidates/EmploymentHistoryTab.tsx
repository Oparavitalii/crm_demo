import { Badge, Paper, Stack, Table, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useEmploymentPeriods } from './api';

interface Props {
  candidateId: string;
}

// Newest-first list of employment episodes. One row per hire/dismiss cycle —
// rehires create new rows. The "active" episode (no dismissedAt) sorts first
// because of the desc(employed_at) ordering in the repo.
export function EmploymentHistoryTab({ candidateId }: Props) {
  const { t } = useTranslation('candidates');
  const { data, isPending } = useEmploymentPeriods(candidateId);

  if (isPending) return <Text c="dimmed">…</Text>;
  if (!data || data.length === 0) {
    return (
      <Paper withBorder p="lg" radius="md">
        <Text c="dimmed">{t('history.empty', { defaultValue: 'Немає історії' })}</Text>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="md" shadow="xs">
      <Stack gap="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('history.employedAt', { defaultValue: 'Початок' })}</Table.Th>
              <Table.Th>{t('history.dismissedAt', { defaultValue: 'Закінчення' })}</Table.Th>
              <Table.Th>{t('history.project', { defaultValue: 'Проєкт' })}</Table.Th>
              <Table.Th>{t('history.housing', { defaultValue: 'Mieszkanie' })}</Table.Th>
              <Table.Th>{t('history.reason', { defaultValue: 'Причина' })}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{new Date(p.employedAt).toLocaleDateString()}</Table.Td>
                <Table.Td>
                  {p.dismissedAt ? (
                    new Date(p.dismissedAt).toLocaleDateString()
                  ) : (
                    <Badge color="green" variant="light">
                      {t('history.active', { defaultValue: 'Активний' })}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{p.projectName ?? '—'}</Table.Td>
                <Table.Td>{p.housingType ? t(`housing.${p.housingType}`) : '—'}</Table.Td>
                <Table.Td>{p.dismissedReason ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Paper>
  );
}
