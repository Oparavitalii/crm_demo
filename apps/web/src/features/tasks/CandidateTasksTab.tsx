import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TASK_STATUSES, type Task, type TaskStatus } from '@opushr/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useDeleteTask, useSetTaskStatus, useTasks } from './api';
import { AddTaskModal } from './AddTaskModal';

interface Props {
  candidateId: string;
}

function assigneeName(task: Task): string {
  const full = `${task.assigneeFirstName ?? ''} ${task.assigneeLastName ?? ''}`.trim();
  return full || '—';
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'gray',
  in_work: 'blue',
  completed: 'green',
  cancelled: 'red',
};

export function CandidateTasksTab({ candidateId }: Props) {
  const { t } = useTranslation(['tasks', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [modalOpen, setModalOpen] = useState(false);
  const { data, isPending } = useTasks({ candidateId, state: 'all' });
  const setStatus = useSetTaskStatus();
  const del = useDeleteTask();

  function handleStatus(task: Task, status: TaskStatus) {
    setStatus.mutate(
      { id: task.id, status },
      {
        onSuccess: () =>
          notifications.show({ color: 'green', message: t('tasks:updated') }),
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  function handleDelete(task: Task) {
    modals.openConfirmModal({
      title: t('tasks:title'),
      children: <Text>{t('tasks:delete.confirm')}</Text>,
      labels: { confirm: t('tasks:title'), cancel: t('tasks:form.cancel') },
      confirmProps: { color: 'red', loading: del.isPending },
      onConfirm: () => {
        del.mutate(task.id, {
          onSuccess: () =>
            notifications.show({ color: 'green', message: t('tasks:delete.deleted') }),
          onError: (err: unknown) => {
            notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
          },
        });
      },
    });
  }

  const items = data?.items ?? [];

  return (
    <Stack>
      <Group justify="flex-end">
        <Button leftSection={<Plus size={16} />} onClick={() => setModalOpen(true)}>
          {t('tasks:addTask')}
        </Button>
      </Group>

      {isPending && <Text c="dimmed" size="sm">...</Text>}

      {!isPending && items.length === 0 && (
        <Text c="dimmed" size="sm">{t('tasks:empty')}</Text>
      )}

      {items.map((task) => {
        const status = (task.status as TaskStatus) ?? 'new';
        const isTerminal = status === 'completed' || status === 'cancelled';
        const canDelete =
          isAdmin || (user?.id != null && task.createdById === user.id);
        return (
          <Paper key={task.id} withBorder p="md" radius="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4} style={{ flex: 1 }}>
                <Group gap="xs" wrap="wrap" align="center">
                  <Text
                    fw={600}
                    style={{
                      textDecoration: isTerminal ? 'line-through' : undefined,
                      opacity: isTerminal ? 0.55 : 1,
                    }}
                  >
                    {task.title}
                  </Text>
                  <Badge size="sm" variant="light" color={STATUS_COLORS[status]}>
                    {t(`tasks:status.${status}`, { defaultValue: status })}
                  </Badge>
                </Group>
                {task.description && (
                  <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                    {task.description}
                  </Text>
                )}
                <Group gap="md" wrap="wrap">
                  <Text size="xs" c="dimmed">
                    {t('tasks:fields.assignee')}: {assigneeName(task)}
                  </Text>
                  {task.dueAt && (
                    <Text size="xs" c="dimmed">
                      {t('tasks:fields.dueAt')}: {new Date(task.dueAt).toLocaleString()}
                    </Text>
                  )}
                </Group>
              </Stack>
              <Group gap="xs" wrap="nowrap">
                <Select
                  size="xs"
                  w={140}
                  data={TASK_STATUSES.map((s) => ({
                    value: s,
                    label: t(`tasks:status.${s}`, { defaultValue: s }),
                  }))}
                  value={status}
                  onChange={(v) => v && handleStatus(task, v as TaskStatus)}
                  allowDeselect={false}
                  disabled={setStatus.isPending}
                />
                {canDelete && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => handleDelete(task)}
                    aria-label={t('tasks:title')}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
          </Paper>
        );
      })}

      <AddTaskModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        candidateId={candidateId}
      />
    </Stack>
  );
}
