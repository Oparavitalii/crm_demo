import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatusLookup, StatusLookupType } from '@opushr/shared';
import { parseApiError } from '@/lib/http';
import { StatusLookupFormModal } from './StatusLookupFormModal';
import {
  useAdminStatusLookups,
  useSoftDeleteStatusLookup,
} from './useStatusLookup';

interface Props {
  type: StatusLookupType;
}

export function StatusLookupTable({ type }: Props) {
  const { t } = useTranslation('admin');
  const { data, isLoading } = useAdminStatusLookups(type);
  const softDelete = useSoftDeleteStatusLookup();

  const [formOpened, formActions] = useDisclosure(false);
  const [editing, setEditing] = useState<StatusLookup | null>(null);
  const [deleting, setDeleting] = useState<StatusLookup | null>(null);

  const openCreate = () => {
    setEditing(null);
    formActions.open();
  };

  const openEdit = (row: StatusLookup) => {
    setEditing(row);
    formActions.open();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      const result = await softDelete.mutateAsync(deleting.id);
      notifications.show({
        color: 'green',
        message: t('statusLookups.notifications.deleted', { count: result.usageCount }),
      });
      setDeleting(null);
    } catch (err) {
      const { code, meta } = parseApiError(err);
      const usageCount = (meta?.usageCount as number | undefined) ?? 0;
      notifications.show({
        color: 'red',
        message: t(`statusLookups.errors.${code ?? 'generic'}`, {
          defaultValue: t('statusLookups.errors.generic'),
          count: usageCount,
        }),
      });
    }
  };

  if (isLoading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t(`statusLookups.descriptions.${type}`)}
        </Text>
        <Button leftSection={<Plus size={16} />} onClick={openCreate}>
          {t('statusLookups.actions.add')}
        </Button>
      </Group>

      <ScrollArea>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('statusLookups.fields.code')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.labelPl')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.labelUa')}</Table.Th>
              <Table.Th style={{ width: 90 }}>{t('statusLookups.fields.sortOrder')}</Table.Th>
              <Table.Th style={{ width: 110 }}>{t('statusLookups.fields.isSystem')}</Table.Th>
              <Table.Th style={{ width: 100 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((row) => (
              <Table.Tr key={row.id} opacity={row.deletedAt ? 0.4 : 1}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {row.code}
                  </Text>
                </Table.Td>
                <Table.Td>{row.labelPl}</Table.Td>
                <Table.Td>{row.labelUa}</Table.Td>
                <Table.Td>{row.sortOrder}</Table.Td>
                <Table.Td>
                  {row.isSystem ? <Badge color="gray">{t('statusLookups.system')}</Badge> : null}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Tooltip label={t('statusLookups.actions.edit')}>
                      <ActionIcon variant="subtle" onClick={() => openEdit(row)}>
                        <Pencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('statusLookups.actions.delete')}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => setDeleting(row)}
                        disabled={!!row.deletedAt}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {(data ?? []).length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text ta="center" c="dimmed" py="md">
                    {t('statusLookups.empty')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <StatusLookupFormModal
        opened={formOpened}
        onClose={formActions.close}
        type={type}
        editing={editing}
      />

      <Modal
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('statusLookups.confirmDelete.title')}
        centered
      >
        <Stack gap="sm">
          <Text>
            {t('statusLookups.confirmDelete.body', {
              code: deleting?.code ?? '',
              labelPl: deleting?.labelPl ?? '',
            })}
          </Text>
          <Text size="sm" c="dimmed">
            {t('statusLookups.confirmDelete.note')}
          </Text>
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setDeleting(null)}>
              {t('statusLookups.actions.cancel')}
            </Button>
            <Button color="red" loading={softDelete.isPending} onClick={confirmDelete}>
              {t('statusLookups.actions.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
