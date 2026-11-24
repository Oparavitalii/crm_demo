import {
  Anchor,
  Badge,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Task } from '@opushr/shared';
import { useAuthStore } from '@/lib/auth-store';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useTasks, useToggleTaskDone } from './api';

function typeBadgeColor(type: string): string {
  if (type === 'contact') return 'blue';
  if (type === 'email') return 'grape';
  return 'gray';
}

interface DueLabelOpts {
  todayLabel: string;
  tomorrowLabel: string;
  overdueLabel: string;
  inDays: (n: number) => string;
}

// Returns "Dziś 15:00" / "Jutro" / "Za 3 dni" / "Przeterminowane".
// Boundaries are based on local-midnight days, not 24h windows — so a task due
// at 23:59 today is still "today" when looked at from 23:00 today.
function dueLabel(dueAt: string | null, opts: DueLabelOpts): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  if (due.getTime() < now.getTime()) return opts.overdueLabel;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round(
    (startOfDue.getTime() - startOfToday.getTime()) / 86_400_000,
  );

  const time = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `${opts.todayLabel} ${time}`;
  if (diffDays === 1) return opts.tomorrowLabel;
  return opts.inDays(diffDays);
}

function candidateName(task: Task): string {
  return `${task.candidateFirstName ?? ''} ${task.candidateLastName ?? ''}`.trim() || '—';
}

export function MyTasksWidget() {
  const { t } = useTranslation(['tasks', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data, isPending } = useTasks({
    assigneeId: user?.id,
    state: 'open',
    pageSize: 20,
  });
  const toggle = useToggleTaskDone();

  const items = data?.items ?? [];

  function handleToggle(task: Task) {
    toggle.mutate(
      { id: task.id, doneAt: task.doneAt },
      {
        onSuccess: () =>
          notifications.show({ color: 'green', message: t('tasks:updated') }),
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  const dueLabelOpts: DueLabelOpts = {
    todayLabel: t('tasks:fields.today'),
    tomorrowLabel: t('tasks:fields.tomorrow'),
    overdueLabel: t('tasks:fields.overdue'),
    inDays: (n) => t('tasks:fields.inDays', { n }),
  };

  const content = (
    <Stack gap="xs">
      {isPending && <Text c="dimmed" size="sm">...</Text>}
      {!isPending && items.length === 0 && (
        <Text c="dimmed" size="sm">{t('tasks:emptyOpen')}</Text>
      )}
      {items.map((task) => {
        const due = dueLabel(task.dueAt, dueLabelOpts);
        const overdue = due === dueLabelOpts.overdueLabel;
        return (
          <Paper key={task.id} withBorder p="sm" radius="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
              <Checkbox
                checked={false}
                onChange={() => handleToggle(task)}
                disabled={toggle.isPending}
                aria-label={t('tasks:fields.done')}
                mt={4}
              />
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs" wrap="wrap">
                  <Text fw={500} size="sm" truncate>{task.title}</Text>
                  <Badge size="xs" variant="light" color={typeBadgeColor(task.type)}>
                    {t(`tasks:types.${task.type}`, { defaultValue: task.type })}
                  </Badge>
                </Group>
                <Group gap="md" wrap="wrap">
                  {due && (
                    <Text size="xs" c={overdue ? 'red' : 'dimmed'} fw={overdue ? 600 : 400}>
                      {due}
                    </Text>
                  )}
                  <Anchor
                    size="xs"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/candidates/${task.candidateId}`);
                    }}
                    href={`/candidates/${task.candidateId}`}
                  >
                    {candidateName(task)}
                  </Anchor>
                </Group>
              </Stack>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm">
      <Stack gap="md">
        <Title order={4}>{t('tasks:myTasks')}</Title>
        {items.length > 5 ? (
          <ScrollArea h={400}>{content}</ScrollArea>
        ) : (
          content
        )}
      </Stack>
    </Paper>
  );
}
