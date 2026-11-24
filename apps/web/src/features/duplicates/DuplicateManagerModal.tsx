import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ExternalLink, ShieldOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DuplicateEntityType, DuplicateRecord } from '@crm/shared';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useAnonymizeCandidate } from '@/features/candidates/api';
import { useDuplicatesOf, useMarkNotDuplicate } from './api';

interface Props {
  opened: boolean;
  onClose: () => void;
  entityType: DuplicateEntityType;
  // The "anchor" record — the row the user clicked. Other duplicates are
  // listed against this one.
  anchorId: string | null;
  anchorName: string;
}

export function DuplicateManagerModal({
  opened,
  onClose,
  entityType,
  anchorId,
  anchorName,
}: Props) {
  const { t } = useTranslation(['duplicates', 'errors', 'common', 'candidates']);
  const apiErrorMessage = useApiErrorMessage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isPending, isFetching } = useDuplicatesOf(entityType, anchorId, opened);
  const markNotDup = useMarkNotDuplicate();
  // 2026-06-12: switched from hard DELETE to anonymize. A hard DELETE failed
  // with 409 FK-violation on any candidate that had comments / dismissals /
  // employment_periods / audit entries — i.e. almost everyone in production.
  // Anonymize is the canonical RODO-aware erasure path used by the detail page
  // too: PII goes to NULL, the row stays so the audit trail and aggregated
  // analytics survive.
  const anonymize = useAnonymizeCandidate();

  const listKey = 'candidates';
  const detailPath = '/candidates';

  function handleNotDuplicate(other: DuplicateRecord) {
    if (!anchorId) return;
    markNotDup.mutate(
      { entityType, idA: anchorId, idB: other.id },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: t('duplicates:markedNotDuplicate', 'Oznaczono jako "nie duplikat"'),
          });
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  function handleDelete(other: DuplicateRecord) {
    modals.openConfirmModal({
      title: t('duplicates:deleteTitle', 'Usuń zapis'),
      children: (
        <Text size="sm">
          {t('duplicates:deleteConfirm', {
            defaultValue: 'Na pewno usunąć "{{name}}"? Operacja nieodwracalna.',
            name: other.displayName,
          })}
        </Text>
      ),
      labels: { confirm: t('common:actions.delete'), cancel: t('common:actions.cancel') },
      confirmProps: { color: 'red', loading: anonymize.isPending },
      onConfirm: () => {
        anonymize.mutate(other.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('duplicates:deleted', 'Usunięto') });
            void qc.invalidateQueries({ queryKey: ['duplicates', entityType] });
            void qc.invalidateQueries({ queryKey: [listKey] });
          },
          onError: (err: unknown) => {
            // Surface the backend error code + meta (e.g. FORBIDDEN when the
            // current user isn't admin) instead of a flat "something went
            // wrong" — that toast was the entire user-visible signal for the
            // 409 FK-violation that the old hard-DELETE used to throw.
            const info = parseApiError(err);
            const detail = info.code
              ? `${info.code}${info.meta ? ': ' + JSON.stringify(info.meta) : ''}`
              : '';
            notifications.show({
              color: 'red',
              message: detail ? `${t('errors:generic')} — ${detail}` : t('errors:generic'),
              autoClose: 8000,
            });
          },
        });
      },
    });
  }

  const items = data?.items ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={
        <Text fw={600}>
          {t('duplicates:title', 'Duplikaty dla: {{name}}', { name: anchorName })}
        </Text>
      }
    >
      <Stack gap="md">
        {(isPending || isFetching) && (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        )}

        {!isPending && items.length === 0 && (
          <Text c="dimmed" ta="center" py="md">
            {t('duplicates:empty', 'Brak duplikatów (lub zostały już oznaczone jako nie-duplikaty).')}
          </Text>
        )}

        {items.length > 0 && (
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('duplicates:cols.name', 'Imię i nazwisko')}</Table.Th>
                <Table.Th>{t('duplicates:cols.contact', 'Kontakt')}</Table.Th>
                <Table.Th>{t('duplicates:cols.matchedBy', 'Pasuje')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {item.displayName || '—'}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      {item.email && <Text size="xs">{item.email}</Text>}
                      {item.phone && <Text size="xs">{item.phone}</Text>}
                      {!item.email && !item.phone && <Text size="xs" c="dimmed">—</Text>}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {item.matchedBy.map((m) => (
                        <Badge key={m} size="xs" variant="light" color="orange">
                          {t(`duplicates:match.${m}`, m)}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label={t('duplicates:actions.open', 'Otwórz')}>
                        <ActionIcon
                          variant="subtle"
                          onClick={() => {
                            onClose();
                            navigate(`${detailPath}/${item.id}`);
                          }}
                        >
                          <ExternalLink size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('duplicates:actions.notDuplicate', 'To nie duplikat')}>
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          onClick={() => handleNotDuplicate(item)}
                          loading={markNotDup.isPending}
                        >
                          <ShieldOff size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('common:actions.delete')}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
