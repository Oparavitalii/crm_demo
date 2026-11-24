import { Badge, Container, Paper, Table, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useCommunicationsHistory } from './api';

const STATUS_COLORS: Record<string, string> = {
  queued: 'gray',
  sent: 'blue',
  delivered: 'green',
  opened: 'teal',
  clicked: 'cyan',
  bounced: 'orange',
  failed: 'red',
};

export function HistoryPage() {
  const { t } = useTranslation('communications');
  const { data, isPending } = useCommunicationsHistory();

  const items = data?.items ?? [];

  return (
    <Container size="xl">
      <Title order={2} mb="md" data-reveal>{t('history.title')}</Title>

      {isPending && <Text c="dimmed">...</Text>}
      {!isPending && items.length === 0 && (
        <Text c="dimmed">{t('history.empty')}</Text>
      )}

      {items.length > 0 && (
        <Paper withBorder radius="md" shadow="sm" data-reveal>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('history.fields.candidate')}</Table.Th>
                <Table.Th>{t('history.fields.channel', { defaultValue: 'Kanał' })}</Table.Th>
                <Table.Th>{t('history.fields.template')}</Table.Th>
                <Table.Th>{t('history.fields.subject')}</Table.Th>
                <Table.Th>{t('history.fields.sender', { defaultValue: 'Wysłał' })}</Table.Th>
                <Table.Th>{t('history.fields.status')}</Table.Th>
                <Table.Th>{t('history.fields.sentAt')}</Table.Th>
                <Table.Th>{t('history.fields.deliveredAt')}</Table.Th>
                <Table.Th>{t('history.fields.openedAt')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>{item.candidateName ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={item.channel === 'sms' ? 'grape' : 'blue'} variant="light">
                      {t(`templates.channel.${item.channel}`, item.channel.toUpperCase())}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{item.templateName ?? '—'}</Table.Td>
                  <Table.Td>{item.subject ?? '—'}</Table.Td>
                  <Table.Td>{item.senderName ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[item.status] ?? 'gray'} variant="light">
                      {t(`history.status.${item.status}`, item.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {item.sentAt ? new Date(item.sentAt).toLocaleString() : '—'}
                  </Table.Td>
                  <Table.Td>
                    {item.deliveredAt ? new Date(item.deliveredAt).toLocaleString() : '—'}
                  </Table.Td>
                  <Table.Td>
                    {item.openedAt ? new Date(item.openedAt).toLocaleString() : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Container>
  );
}
