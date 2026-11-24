import { Button, Group, Modal, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceChannel, StatusLookup, StatusLookupType } from '@opushr/shared';
import { SOURCE_CHANNELS } from '@opushr/shared';
import { parseApiError } from '@/lib/http';
import {
  useCreateStatusLookup,
  useUpdateStatusLookup,
} from './useStatusLookup';

interface Props {
  opened: boolean;
  onClose: () => void;
  type: StatusLookupType;
  editing: StatusLookup | null;
}

interface FormValues {
  code: string;
  labelPl: string;
  labelUa: string;
  groupKey: string;
  sortOrder: number;
}

const CODE_RE = /^[a-z][a-z0-9_]{1,49}$/;

export function StatusLookupFormModal({ opened, onClose, type, editing }: Props) {
  const { t } = useTranslation('admin');
  const create = useCreateStatusLookup();
  const update = useUpdateStatusLookup();
  // The retention-channel selector only applies to source lookups.
  const isSource = type === 'sources';

  const form = useForm<FormValues>({
    initialValues: { code: '', labelPl: '', labelUa: '', groupKey: '', sortOrder: 0 },
    validate: {
      code: (v) => (CODE_RE.test(v) ? null : t('statusLookups.errors.code_format')),
      labelPl: (v) => (v.trim().length === 0 ? t('statusLookups.errors.required') : null),
      labelUa: (v) => (v.trim().length === 0 ? t('statusLookups.errors.required') : null),
    },
  });

  useEffect(() => {
    if (opened) {
      form.setValues(
        editing
          ? {
              code: editing.code,
              labelPl: editing.labelPl,
              labelUa: editing.labelUa,
              groupKey: editing.groupKey ?? '',
              sortOrder: editing.sortOrder,
            }
          : { code: '', labelPl: '', labelUa: '', groupKey: '', sortOrder: 0 },
      );
      form.resetDirty();
      form.resetTouched();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing]);

  const channelOptions = SOURCE_CHANNELS.map((c) => ({
    value: c,
    label: t(`statusLookups.channels.${c}`),
  }));

  const submit = async (values: FormValues) => {
    // Only sources carry a channel; coerce '' → null so it clears the field.
    const groupKey = isSource ? ((values.groupKey || null) as SourceChannel | null) : undefined;
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            labelPl: values.labelPl,
            labelUa: values.labelUa,
            sortOrder: values.sortOrder,
            ...(isSource ? { groupKey } : {}),
          },
        });
        notifications.show({ color: 'green', message: t('statusLookups.notifications.updated') });
      } else {
        await create.mutateAsync({
          type,
          code: values.code,
          labelPl: values.labelPl,
          labelUa: values.labelUa,
          sortOrder: values.sortOrder,
          ...(isSource ? { groupKey } : {}),
        });
        notifications.show({ color: 'green', message: t('statusLookups.notifications.created') });
      }
      onClose();
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('statusLookups.editTitle') : t('statusLookups.createTitle')}
      centered
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput
            label={t('statusLookups.fields.code')}
            placeholder="my_custom_code"
            description={t('statusLookups.codeFormatHint')}
            required
            disabled={!!editing}
            {...form.getInputProps('code')}
          />
          <TextInput
            label={t('statusLookups.fields.labelPl')}
            required
            {...form.getInputProps('labelPl')}
          />
          <TextInput
            label={t('statusLookups.fields.labelUa')}
            required
            {...form.getInputProps('labelUa')}
          />
          {isSource && (
            <Select
              label={t('statusLookups.fields.channel')}
              description={t('statusLookups.channelHint')}
              data={channelOptions}
              clearable
              {...form.getInputProps('groupKey')}
            />
          )}
          <NumberInput
            label={t('statusLookups.fields.sortOrder')}
            min={0}
            max={10000}
            {...form.getInputProps('sortOrder')}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              {t('statusLookups.actions.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending || update.isPending}>
              {t('statusLookups.actions.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
