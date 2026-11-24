import { useState } from 'react';
import {
  Badge,
  Box,
  Container,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { EMPLOYER_INQUIRY_STATUSES, type EmployerInquiryStatus } from '@opushr/shared';
import { useEmployerInquiries } from './api';

const STATUS_COLORS: Record<EmployerInquiryStatus, string> = {
  new: 'blue',
  contacted: 'cyan',
  accepted: 'green',
  rejected: 'red',
  archived: 'gray',
};

export function EmployerInquiryListPage() {
  const { t } = useTranslation('employers');
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<EmployerInquiryStatus | null>(null);
  const [page, setPage] = useState(1);

  const pageSize = 25;
  const { data, isPending } = useEmployerInquiries({
    q: q || undefined,
    status: status ?? undefined,
    page,
    pageSize,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="xl">
      <Stack gap="md">
        <Title order={2} data-reveal>{t('list.title')}</Title>

        <Paper withBorder radius="md" p="md" shadow="xs" data-reveal>
          <Group>
            <TextInput
              leftSection={<Search size={14} />}
              placeholder={t('list.search')}
              value={q}
              onChange={(e) => {
                setQ(e.currentTarget.value);
                setPage(1);
              }}
              w={300}
            />
            <Select
              placeholder={t('list.filters.allStatuses')}
              data={EMPLOYER_INQUIRY_STATUSES.map((s) => ({
                value: s,
                label: t(`status.${s}`),
              }))}
              value={status}
              onChange={(v) => {
                setStatus((v as EmployerInquiryStatus) ?? null);
                setPage(1);
              }}
              clearable
              w={220}
            />
          </Group>
        </Paper>

        {isPending && <Text c="dimmed">...</Text>}
        {!isPending && items.length === 0 && (
          <Text c="dimmed">{t('list.empty')}</Text>
        )}

        {items.length > 0 && (
          <>
            <Text c="dimmed" size="sm">
              {t('list.total', { count: total })}
            </Text>
            <Paper withBorder radius="md" shadow="sm" data-reveal>
              <Box style={{ overflowX: 'auto' }}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('fields.companyName')}</Table.Th>
                      <Table.Th>{t('fields.contactPerson')}</Table.Th>
                      <Table.Th>{t('fields.email')}</Table.Th>
                      <Table.Th>{t('fields.phone')}</Table.Th>
                      <Table.Th>{t('fields.status')}</Table.Th>
                      <Table.Th>{t('fields.createdAt')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {items.map((i) => (
                      <Table.Tr
                        key={i.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/employer-inquiries/${i.id}`)}
                      >
                        <Table.Td><strong>{i.companyName}</strong></Table.Td>
                        <Table.Td>{i.contactPerson}</Table.Td>
                        <Table.Td>{i.email}</Table.Td>
                        <Table.Td>{i.phone}</Table.Td>
                        <Table.Td>
                          <Badge color={STATUS_COLORS[i.status]} variant="light">
                            {t(`status.${i.status}`)}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{new Date(i.createdAt).toLocaleDateString()}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Box>
            </Paper>

            {totalPages > 1 && (
              <Group justify="center">
                <Pagination value={page} onChange={setPage} total={totalPages} />
              </Group>
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
