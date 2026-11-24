import { useState } from 'react';
import {
  Badge,
  Code,
  Collapse,
  Group,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { AuditLogEntry } from '@opushr/shared';
import { useAuditLog } from './api';
import { ACTION_OPTIONS, ENTITY_TYPE_OPTIONS } from './constants';

function ExpandableRow({ item }: { item: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('admin');

  return (
    <>
      <Table.Tr
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <Table.Td>
          <Text size="xs" c="dimmed">{new Date(item.createdAt).toLocaleString()}</Text>
        </Table.Td>
        <Table.Td>
          <Badge variant="light" size="sm">{item.action}</Badge>
        </Table.Td>
        <Table.Td>{item.entityType}</Table.Td>
        <Table.Td>
          <Text size="xs" truncate maw={180}>{item.entityId ?? '—'}</Text>
        </Table.Td>
        <Table.Td>
          <Text size="xs" truncate maw={200}>
            {item.actorFirstName || item.actorLastName
              ? `${item.actorFirstName ?? ''} ${item.actorLastName ?? ''}`.trim()
              : (item.actorId ?? '—')}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed">{item.ip ?? '—'}</Text>
        </Table.Td>
      </Table.Tr>
      {open && (
        <Table.Tr>
          <Table.Td colSpan={6} bg="gray.0" p="sm">
            <Collapse in={open}>
              <Stack gap="xs">
                <Group gap="xl" wrap="wrap">
                  <Stack gap={2} style={{ flex: 1, minWidth: 260 }}>
                    <Text size="xs" fw={600} c="dimmed">{t('auditLog.oldValue')}</Text>
                    <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {item.oldValue !== null
                        ? JSON.stringify(item.oldValue, null, 2)
                        : 'null'}
                    </Code>
                  </Stack>
                  <Stack gap={2} style={{ flex: 1, minWidth: 260 }}>
                    <Text size="xs" fw={600} c="dimmed">{t('auditLog.newValue')}</Text>
                    <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {item.newValue !== null
                        ? JSON.stringify(item.newValue, null, 2)
                        : 'null'}
                    </Code>
                  </Stack>
                </Group>
              </Stack>
            </Collapse>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

export function AuditLogTab() {
  const { t } = useTranslation('admin');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string | null>(null);
  const [entityId, setEntityId] = useState('');

  const query = {
    page,
    pageSize: 20,
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId.trim() ? { entityId: entityId.trim() } : {}),
  };

  const { data, isPending } = useAuditLog(query);
  const items = data?.items ?? [];
  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  function resetPage() {
    setPage(1);
  }

  return (
    <>
      <Group mb="md" wrap="wrap" gap="sm">
        <Select
          placeholder={t('auditLog.action')}
          data={ACTION_OPTIONS.map((a) => ({ value: a, label: t(`actions.${a}`, a) }))}
          value={action}
          onChange={(v) => { setAction(v); resetPage(); }}
          clearable
          searchable
          style={{ minWidth: 220 }}
        />
        <Select
          placeholder={t('auditLog.entityType')}
          data={ENTITY_TYPE_OPTIONS.map((e) => ({ value: e, label: e }))}
          value={entityType}
          onChange={(v) => { setEntityType(v); resetPage(); }}
          clearable
          style={{ minWidth: 160 }}
        />
        <TextInput
          placeholder={t('auditLog.entityId')}
          value={entityId}
          onChange={(e) => { setEntityId(e.currentTarget.value); resetPage(); }}
          style={{ minWidth: 240 }}
        />
      </Group>

      {isPending && <Text c="dimmed">...</Text>}
      {!isPending && items.length === 0 && (
        <Text c="dimmed">{t('auditLog.empty')}</Text>
      )}

      {items.length > 0 && (
        <>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('auditLog.timestamp')}</Table.Th>
                <Table.Th>{t('auditLog.action')}</Table.Th>
                <Table.Th>{t('auditLog.entityType')}</Table.Th>
                <Table.Th>{t('auditLog.entityId')}</Table.Th>
                <Table.Th>{t('auditLog.actor')}</Table.Th>
                <Table.Th>{t('auditLog.ip')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <ExpandableRow key={item.id} item={item} />
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
