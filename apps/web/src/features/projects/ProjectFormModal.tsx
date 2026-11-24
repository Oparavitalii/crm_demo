import {
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import type { Project } from '@opushr/shared';
import { parseApiError } from '@/lib/http';
import { useCreateProject, useUpdateProject } from './api';

interface ProjectFormValues {
  name: string;
  isActive: boolean;
  headcountNeeded: number;
  startDate: Date | null;
  notes: string;
}

function parseIsoDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ProjectFormModal({
  opened,
  onClose,
  initial,
}: {
  opened: boolean;
  onClose: () => void;
  initial?: Project;
}) {
  const { t } = useTranslation('projects');
  const create = useCreateProject();
  const update = useUpdateProject(initial?.id ?? '');
  const isEdit = !!initial;
  // NOTE: useForm initialValues are captured on first mount only. The parent
  // passes `key={initial?.id ?? 'new'}` on this Modal so React remounts the
  // component for each edit, ensuring `initial` is reflected in the inputs.
  const form = useForm<ProjectFormValues>({
    initialValues: {
      name: initial?.name ?? '',
      isActive: initial?.isActive ?? true,
      headcountNeeded: initial?.headcountNeeded ?? 0,
      startDate: parseIsoDate(initial?.startDate),
      notes: initial?.notes ?? '',
    },
    validate: {
      name: (v) => (v.trim() ? null : t('form.nameRequired', { defaultValue: 'Wymagane' })),
    },
  });

  function handleSubmit(values: ProjectFormValues) {
    const payload = {
      name: values.name,
      isActive: values.isActive,
      headcountNeeded: values.headcountNeeded,
      startDate: toIsoDate(values.startDate),
      notes: values.notes.trim() || null,
    };
    const op = isEdit ? update : create;
    op.mutate(payload, {
      onSuccess: () => {
        notifications.show({
          color: 'green',
          message: t(isEdit ? 'updated' : 'created', { defaultValue: 'OK' }),
        });
        form.reset();
        onClose();
      },
      onError: (err) => {
        const { code } = parseApiError(err);
        notifications.show({
          color: 'red',
          message:
            code === 'DUPLICATE'
              ? t('errors.duplicate', { defaultValue: 'Projekt o tej nazwie już istnieje' })
              : t('errors.generic', { defaultValue: 'Błąd' }),
        });
      },
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        isEdit
          ? t('editTitle', { defaultValue: 'Edytuj projekt' })
          : t('createTitle', { defaultValue: 'Nowy projekt' })
      }
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t('fields.name', { defaultValue: 'Nazwa' })}
            required
            data-autofocus
            {...form.getInputProps('name')}
          />
          <Switch
            label={t('fields.isActive', { defaultValue: 'Aktywny' })}
            {...form.getInputProps('isActive', { type: 'checkbox' })}
          />
          <NumberInput
            label={t('fields.headcountNeeded', { defaultValue: 'Potrzebne' })}
            min={0}
            {...form.getInputProps('headcountNeeded')}
          />
          <DateInput
            label={t('fields.startDate', { defaultValue: 'Data startu' })}
            valueFormat="DD.MM.YYYY"
            clearable
            {...form.getInputProps('startDate')}
          />
          <Textarea
            label={t('fields.notes', { defaultValue: 'Notatki' })}
            autosize
            minRows={2}
            maxRows={6}
            maxLength={2000}
            {...form.getInputProps('notes')}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              {t('form.cancel', { defaultValue: 'Anuluj' })}
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {t('form.save', { defaultValue: 'Zapisz' })}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
