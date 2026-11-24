import { useState } from 'react';
import {
  Badge,
  Group,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ConsentHistoryItem, ListConsentHistoryQuery } from '@opushr/shared';
import { useConsentHistory } from './api';

const PAGE_SIZE = 20;

const CONSENT_TYPE_OPTIONS = [
  'application_form',
  'email_marketing',
  'sms_marketing',
] as const;

type ConsentTypeFilter = ListConsentHistoryQuery['consentType'];
type StatusFilter = ListConsentHistoryQuery['status'];

function ConsentRow({ item }: { item: ConsentHistoryItem }) {
  const { t } = useTranslation('admin');
  const withdrawn = item.withdrawnAt !== null;

  return (
    <Table.Tr style={withdrawn ? { opacity: 0.55 } : undefined}>
      <Table.Td>
        <Text size="sm">{item.candidateName ?? '—'}</Text>
      </Table.Td>
      <Table.Td>
        <Stack gap={0}>
          <Text size="xs">{item.candidateEmail ?? '—'}</Text>
          {item.candidatePhone && (
            <Text size="xs" c="dimmed">{item.candidatePhone}</Text>
          )}
        </Stack>
      </Table.Td>
      <Table.Td>
        <Badge variant="light" size="sm">
          {t(`consentHistory.types.${item.consentType}`, item.consentType)}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {item.source ? t(`consentHistory.sources.${item.source}`, item.source) : '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">{new Date(item.acceptedAt).toLocaleString()}</Text>
      </Table.Td>
      <Table.Td>
        {item.withdrawnAt ? (
          <Text size="xs">{new Date(item.withdrawnAt).toLocaleString()}</Text>
        ) : (
          <Text size="xs" c="dimmed">—</Text>
        )}
      </Table.Td>
      <Table.Td>
        {withdrawn ? (
          <Badge color="red" variant="light" size="sm">
            {t('consentHistory.statusWithdrawn')}
          </Badge>
        ) : (
          <Badge color="green" variant="light" size="sm">
            {t('consentHistory.statusActive')}
          </Badge>
        )}
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">{item.ip ?? '—'}</Text>
      </Table.Td>
    </Table.Tr>
  );
}

export function ConsentHistoryTab() {
  const { t } = useTranslation('admin');
  const [page, setPage] = useState(1);
  const [consentType, setConsentType] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const query: Partial<ListConsentHistoryQuery> = {
    page,
    pageSize: PAGE_SIZE,
    ...(consentType ? { consentType: consentType as ConsentTypeFilter } : {}),
    ...(status ? { status: status as StatusFilter } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };

  const { data, isPending } = useConsentHistory(query);
  const items = data?.items ?? [];
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  function resetPage() {
    setPage(1);
  }

  return (
    <>
      <Group mb="md" wrap="wrap" gap="sm">
        <Select
          placeholder={t('consentHistory.filterType')}
          data={CONSENT_TYPE_OPTIONS.map((c) => ({
            value: c,
            label: t(`consentHistory.types.${c}`),
          }))}
          value={consentType}
          onChange={(v) => { setConsentType(v); resetPage(); }}
          clearable
          style={{ minWidth: 180 }}
        />
        <Select
          placeholder={t('consentHistory.filterStatus')}
          data={[
            { value: 'active', label: t('consentHistory.statusActive') },
            { value: 'withdrawn', label: t('consentHistory.statusWithdrawn') },
          ]}
          value={status}
          onChange={(v) => { setStatus(v); resetPage(); }}
          clearable
          style={{ minWidth: 160 }}
        />
        <TextInput
          placeholder={t('consentHistory.search')}
          value={q}
          onChange={(e) => { setQ(e.currentTarget.value); resetPage(); }}
          style={{ minWidth: 240 }}
        />
      </Group>

      {isPending && <Text c="dimmed">...</Text>}
      {!isPending && items.length === 0 && (
        <Text c="dimmed">{t('consentHistory.empty')}</Text>
      )}

      {items.length > 0 && (
        <>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('consentHistory.candidate')}</Table.Th>
                <Table.Th>{t('consentHistory.contact')}</Table.Th>
                <Table.Th>{t('consentHistory.type')}</Table.Th>
                <Table.Th>{t('consentHistory.source')}</Table.Th>
                <Table.Th>{t('consentHistory.acceptedAt')}</Table.Th>
                <Table.Th>{t('consentHistory.withdrawnAt')}</Table.Th>
                <Table.Th>{t('consentHistory.status')}</Table.Th>
                <Table.Th>{t('consentHistory.ip')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <ConsentRow key={item.id} item={item} />
              ))}
            </Table.Tbody>
          </Table>
          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPages} value={page} onChange={setPage} />
            </Group>
          )}
        </>
      )}
    </>
  );
}
