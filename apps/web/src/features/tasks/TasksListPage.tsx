import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Container,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { TASK_STATUSES, type Task, type TaskStatus } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useDirectoryUsers } from '@/features/directory/api';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useDeleteTask, useSetTaskStatus, useTasks } from './api';
import { AddTaskModal } from './AddTaskModal';

const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'gray',
  in_work: 'blue',
  completed: 'green',
  cancelled: 'red',
};

export function TasksListPage() {
  const { t } = useTranslation(['tasks', 'candidates', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [modalOpen, setModalOpen] = useState(false);

  const [filters, setFilters] = useQueryStates(
    {
      status: parseAsString.withDefault(''),
      assigneeId: parseAsString,
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace' },
  );

  const pageSize = 50;
  const { data, isPending } = useTasks({
    page: filters.page,
    pageSize,
    status: filters.status ? (filters.status as TaskStatus) : undefined,
    assigneeId: filters.assigneeId ?? undefined,
  });

  const { data: usersData } = useDirectoryUsers();
  const assigneeOptions = (usersData?.items ?? [])
    .filter((u) => u.isActive)
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }));

  const statusOptions = TASK_STATUSES.map((s) => ({
    value: s,
    label: t(`tasks:status.${s}`, { defaultValue: s }),
  }));

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
      // 2026-06-13: confirm modal labels were wrong — both buttons pulled the
      // page title ("Zadania"). Now: title = "Usuń zadanie", confirm button =
      // "Usuń", cancel = "Anuluj".
      title: t('tasks:delete.title', { defaultValue: 'Usuń zadanie' }),
      children: <Text>{t('tasks:delete.confirm')}</Text>,
      labels: {
        confirm: t('tasks:delete.button', { defaultValue: 'Usuń' }),
        cancel: t('tasks:form.cancel'),
      },
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
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Container size="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={2}>{t('tasks:title')}</Title>
          <Button leftSection={<Plus size={16} />} onClick={() => setModalOpen(true)}>
            {t('tasks:addTask')}
          </Button>
        </Group>

        <Paper withBorder radius="md" p="md" shadow="xs">
          <Group align="flex-end" wrap="wrap">
            <Select
              label={t('tasks:fields.status')}
              placeholder={t('tasks:filters.allStatuses', { defaultValue: 'Всі статуси' })}
              data={statusOptions}
              value={filters.status || null}
              onChange={(v) => setFilters({ status: v ?? '', page: 1 })}
              clearable
              w={180}
            />
            {isAdmin && (
              <Select
                label={t('tasks:fields.assignee')}
                placeholder={t('tasks:filters.allAssignees')}
                data={assigneeOptions}
                value={filters.assigneeId}
                onChange={(v) => setFilters({ assigneeId: v, page: 1 })}
                clearable
                searchable
                w={220}
              />
            )}
          </Group>
        </Paper>

        {isPending && <Text c="dimmed">...</Text>}
        {!isPending && items.length === 0 && (
          <Text c="dimmed">{t('tasks:empty')}</Text>
        )}

        {items.length > 0 && (
          <Paper withBorder radius="md" shadow="sm">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('tasks:fields.title')}</Table.Th>
                  <Table.Th>{t('tasks:fields.candidate')}</Table.Th>
                  <Table.Th>{t('tasks:fields.assignee')}</Table.Th>
                  <Table.Th>{t('tasks:fields.createdBy', { defaultValue: 'Хто призначив' })}</Table.Th>
                  <Table.Th>{t('tasks:fields.status')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((task) => {
                  const status = (task.status as TaskStatus) ?? 'new';
                  const candidate =
                    `${task.candidateFirstName ?? ''} ${task.candidateLastName ?? ''}`.trim();
                  const assignee =
                    `${task.assigneeFirstName ?? ''} ${task.assigneeLastName ?? ''}`.trim() || '—';
                  const createdBy =
                    `${task.createdByFirstName ?? ''} ${task.createdByLastName ?? ''}`.trim() || '—';
                  const canDelete =
                    isAdmin || (user?.id != null && task.createdById === user.id);
                  return (
                    <Table.Tr key={task.id}>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text fw={500}>{task.title}</Text>
                          {task.description && (
                            <Text size="xs" c="dimmed" lineClamp={2}>
                              {task.description}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        {candidate && task.candidateId ? (
                          <Button
                            variant="subtle"
                            size="compact-sm"
                            onClick={() => navigate(`/candidates/${task.candidateId}`)}
                          >
                            {candidate}
                          </Button>
                        ) : (
                          <Text c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>{assignee}</Table.Td>
                      <Table.Td>{createdBy}</Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <Badge color={STATUS_COLORS[status]} variant="light">
                            {t(`tasks:status.${status}`, { defaultValue: status })}
                          </Badge>
                          <Select
                            size="xs"
                            w={140}
                            data={statusOptions}
                            value={status}
                            onChange={(v) => v && handleStatus(task, v as TaskStatus)}
                            allowDeselect={false}
                            disabled={setStatus.isPending}
                          />
                        </Group>
                      </Table.Td>
                      <Table.Td>
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
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        )}

        {totalPages > 1 && (
          <Group justify="center">
            <Pagination
              value={filters.page}
              onChange={(p) => setFilters({ page: p })}
              total={totalPages}
            />
          </Group>
        )}
      </Stack>

      <AddTaskModal opened={modalOpen} onClose={() => setModalOpen(false)} />
    </Container>
  );
}
