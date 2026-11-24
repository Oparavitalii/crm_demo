import { useEffect } from 'react';
import { Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useDirectoryUsers } from '@/features/directory/api';
import { useAuthStore } from '@/lib/auth-store';
import { useCreateTask } from './api';

interface Props {
  opened: boolean;
  onClose: () => void;
  // When set, task is tied to this candidate (per-candidate tab). When omitted,
  // it's a standalone task (from the Tasks sidebar panel).
  candidateId?: string;
}

interface FormValues {
  title: string;
  description: string;
  assigneeId: string;
}

// Simplified task creation per 2026-06-02 requirements: name + description +
// responsible. Type defaults to 'other' on the backend; due date moved out of
// scope for now (can be added later in the edit flow).
export function AddTaskModal({ opened, onClose, candidateId }: Props) {
  const { t } = useTranslation(['tasks', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const create = useCreateTask();
  const { data: usersData } = useDirectoryUsers();
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id;
  // Recruiters / coordinators / readonly may only assign tasks to themselves.
  // Admin can pick anyone — the assignee Select stays unrestricted in that case.
  const isAdmin = currentUser?.role === 'admin';

  const form = useForm<FormValues>({
    initialValues: { title: '', description: '', assigneeId: '' },
    validate: {
      title: (v) => (v.trim() ? null : t('tasks:form.titleRequired')),
      assigneeId: (v) => (v ? null : t('tasks:form.assigneeRequired')),
    },
  });

  // Default assignee to the current user when the modal opens — quickest path
  // for "assign to myself". Admin can still pick someone else; non-admin can't.
  useEffect(() => {
    if (opened && currentUserId && !form.values.assigneeId) {
      form.setFieldValue('assigneeId', currentUserId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, currentUserId]);

  const assigneeOptions = (usersData?.items ?? [])
    .filter((u) => u.isActive)
    .filter((u) => isAdmin || u.id === currentUserId)
    .map((u) => ({
      value: u.id,
      label: `${u.firstName} ${u.lastName}`.trim(),
    }));

  function handleSubmit(values: FormValues) {
    create.mutate(
      {
        candidateId: candidateId ?? null,
        assigneeId: values.assigneeId,
        title: values.title.trim(),
        description: values.description.trim() || null,
      },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('tasks:created') });
          form.reset();
          onClose();
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  function handleClose() {
    form.reset();
    onClose();
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={t('tasks:addTask')}>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t('tasks:fields.title')}
            required
            {...form.getInputProps('title')}
          />
          <Textarea
            label={t('tasks:fields.description', { defaultValue: 'Опис' })}
            minRows={3}
            autosize
            maxLength={5000}
            {...form.getInputProps('description')}
          />
          <Select
            label={t('tasks:fields.assignee')}
            data={assigneeOptions}
            required
            searchable={isAdmin}
            disabled={!isAdmin}
            description={!isAdmin ? t('tasks:form.assigneeSelfOnly', { defaultValue: 'Можна створити завдання тільки для себе' }) : undefined}
            {...form.getInputProps('assigneeId')}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose}>
              {t('tasks:form.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('tasks:form.submit')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
