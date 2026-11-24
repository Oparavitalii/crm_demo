import { useState } from 'react';
import { ActionIcon, Button, Group, Stack, Table, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Dismissal } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useDismissals, useDeleteDismissal } from './dismissals-api';
import { DismissalFormModal } from './DismissalFormModal';
import { DismissModal } from './DismissModal';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

interface Props {
  candidateId: string;
}

export function DismissalsTab({ candidateId }: Props) {
  const { t, i18n } = useTranslation('operations');
  const apiErrorMessage = useApiErrorMessage();
  const role = useAuthStore((s) => s.user?.role);
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Dismissal | undefined>(undefined);

  const { data, isPending } = useDismissals(candidateId);
  const del = useDeleteDismissal();

  function handleDelete(d: Dismissal) {
    modals.openConfirmModal({
      title: t('dismissals.detail.delete'),
      children: <Text>{t('dismissals.detail.deleteConfirm')}</Text>,
      labels: { confirm: t('dismissals.detail.delete'), cancel: t('dismissals.form.cancel') },
      confirmProps: { color: 'red', loading: del.isPending },
      onConfirm: () => {
        del.mutate(
          { id: d.id, candidateId },
          {
            onSuccess: () => notifications.show({ color: 'green', message: t('dismissals.detail.deleted') }),
            onError: (err: unknown) => {
              notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
            },
          },
        );
      },
    });
  }

  const items = data?.items ?? [];

  function formatReason(reason: string): string {
    const row = reasonLookup?.find((r) => r.code === reason);
    if (row) return i18n.language === 'pl' ? row.labelPl : row.labelUa;
    return reason;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={500}>{t('dismissals.list.title')}</Text>
        <Button leftSection={<Plus size={16} />} size="sm" onClick={() => setCreateOpen(true)}>
          {t('dismissals.list.add')}
        </Button>
      </Group>

      {isPending && <Text c="dimmed" size="sm">...</Text>}
      {!isPending && items.length === 0 && (
        <Text c="dimmed" size="sm">{t('dismissals.list.empty')}</Text>
      )}

      {items.length > 0 && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('dismissals.fields.dismissedAt')}</Table.Th>
              <Table.Th>{t('dismissals.fields.reason')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>{new Date(d.dismissedAt).toLocaleDateString()}</Table.Td>
                {/* reasonCode first, matching the registry table
                    (dismissals/columns.tsx). formatReason looks the value up
                    BY CODE, so passing `reason` — which holds a label — only
                    ever worked through its fallback, and showed a Polish label
                    to a Ukrainian user and vice versa. */}
                <Table.Td>{formatReason(d.reasonCode || d.reason)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    {(role === 'admin' || role === 'recruiter') && (
                      <ActionIcon variant="subtle" onClick={() => setEditing(d)}>
                        <Edit size={15} />
                      </ActionIcon>
                    )}
                    {role === 'admin' && (
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(d)}>
                        <Trash2 size={15} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* 2026-06-02: "+ Add" now goes through the lifecycle dismiss endpoint
          so the candidate's status flips to `dismissed` AND the dismissals row
          is created in one transaction. DismissalFormModal stays for editing
          existing rows (re-uses the legacy PATCH /dismissals/:id). */}
      <DismissModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        candidateId={candidateId}
      />
      {editing && (
        <DismissalFormModal
          opened={!!editing}
          onClose={() => setEditing(undefined)}
          candidateId={candidateId}
          initial={editing}
        />
      )}
    </Stack>
  );
}
