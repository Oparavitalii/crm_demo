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
import { notifications } from '@mantine/notifications';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatusLookup } from '@crm/shared';
import { parseApiError } from '@/lib/http';
import {
  useHardDeleteStatusLookup,
  useRestoreStatusLookup,
  useTrashedStatusLookups,
} from './useStatusLookup';

export function TrashTab() {
  const { t } = useTranslation('admin');
  const { data, isLoading } = useTrashedStatusLookups();
  const restore = useRestoreStatusLookup();
  const hardDelete = useHardDeleteStatusLookup();
  const [hardDeleting, setHardDeleting] = useState<StatusLookup | null>(null);

  const onRestore = async (row: StatusLookup) => {
    try {
      await restore.mutateAsync(row.id);
      notifications.show({ color: 'green', message: t('statusLookups.notifications.restored') });
    } catch (err) {
      const { code } = parseApiError(err);
      notifications.show({
        color: 'red',
        message: t(`statusLookups.errors.${code ?? 'generic'}`, {
          defaultValue: t('statusLookups.errors.generic'),
        }),
      });
    }
  };

  const confirmHardDelete = async () => {
    if (!hardDeleting) return;
    try {
      await hardDelete.mutateAsync(hardDeleting.id);
      notifications.show({
        color: 'green',
        message: t('statusLookups.notifications.hardDeleted'),
      });
      setHardDeleting(null);
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
      <Text size="sm" c="dimmed">
        {t('statusLookups.trash.description')}
      </Text>
      <ScrollArea>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('statusLookups.fields.type')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.code')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.labelPl')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.labelUa')}</Table.Th>
              <Table.Th>{t('statusLookups.fields.deletedAt')}</Table.Th>
              <Table.Th style={{ width: 120 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td>
                  <Badge variant="light">{t(`statusLookups.tabs.${row.type}`)}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {row.code}
                  </Text>
                </Table.Td>
                <Table.Td>{row.labelPl}</Table.Td>
                <Table.Td>{row.labelUa}</Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {row.deletedAt ? new Date(row.deletedAt).toLocaleString() : '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Tooltip label={t('statusLookups.actions.restore')}>
                      <ActionIcon variant="subtle" color="green" onClick={() => onRestore(row)}>
                        <RotateCcw size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('statusLookups.actions.hardDelete')}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => setHardDeleting(row)}
                        disabled={row.isSystem}
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
                    {t('statusLookups.trash.empty')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Modal
        opened={!!hardDeleting}
        onClose={() => setHardDeleting(null)}
        title={t('statusLookups.confirmHardDelete.title')}
        centered
      >
        <Stack gap="sm">
          <Text>
            {t('statusLookups.confirmHardDelete.body', { code: hardDeleting?.code ?? '' })}
          </Text>
          <Text size="sm" c="red">
            {t('statusLookups.confirmHardDelete.warning')}
          </Text>
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setHardDeleting(null)}>
              {t('statusLookups.actions.cancel')}
            </Button>
            <Button color="red" loading={hardDelete.isPending} onClick={confirmHardDelete}>
              {t('statusLookups.actions.hardDelete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
