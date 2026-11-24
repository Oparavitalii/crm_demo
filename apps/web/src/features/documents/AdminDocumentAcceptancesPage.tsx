import { Button, Container, Group, Table, Text, Title } from '@mantine/core';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { downloadAcceptancesCsv, useDocumentAcceptances } from './api';

export function AdminDocumentAcceptancesPage() {
  const { t } = useTranslation('documents');
  const { id } = useParams<{ id: string }>();
  const { data, isPending } = useDocumentAcceptances(id);
  const items = data?.items ?? [];

  return (
    <Container size="xl">
      <Group justify="space-between" mb="md">
        <Title order={2}>{t('admin.acceptances.title')}</Title>
        <Button
          leftSection={<Download size={16} />}
          onClick={() => id && void downloadAcceptancesCsv(id)}
          disabled={!id}
        >
          {t('actions.exportCsv')}
        </Button>
      </Group>

      {isPending && <Text c="dimmed">…</Text>}
      {!isPending && items.length === 0 && <Text c="dimmed">{t('admin.acceptances.empty')}</Text>}

      {items.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Wersja</Table.Th>
              <Table.Th>Użytkownik</Table.Th>
              <Table.Th>Zaakceptowano</Table.Th>
              <Table.Th>IP</Table.Th>
              <Table.Th>User-Agent</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.version}</Table.Td>
                <Table.Td>
                  {a.userFirstName} {a.userLastName} ({a.userEmail})
                </Table.Td>
                <Table.Td>{new Date(a.acceptedAt).toLocaleString('pl-PL')}</Table.Td>
                <Table.Td>
                  <code>{a.ip}</code>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {a.userAgent}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
