import { Button, Group, Modal, Stack, Textarea } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import type { CreateDismissalInput, Dismissal } from '@opushr/shared';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useCreateDismissal, useUpdateDismissal } from './dismissals-api';
import { LookupSelect } from '@/features/admin-statuses/LookupSelect';

interface Props {
  opened: boolean;
  onClose: () => void;
  candidateId: string;
  initial?: Dismissal;
}

interface FormValues {
  dismissedAt: Date | null;
  // Canonical code from status_lookups (e.g. 'absenteeism'), NOT a label.
  // Until 2026-07-30 this was a free-text Autocomplete holding the localized
  // label, which meant a typed reason never joined the taxonomy: "choroba",
  // "Choroba" and "chorobа" (Cyrillic а) became three separate buckets in the
  // retention report, and nothing ever merged them. LookupSelect lets the user
  // ADD a reason inline instead, so every value that reaches the database
  // exists in status_lookups exactly once.
  reason: string;
  notes: string;
}

export function DismissalFormModal({ opened, onClose, candidateId, initial }: Props) {
  const { t } = useTranslation('operations');
  const apiErrorMessage = useApiErrorMessage();
  const create = useCreateDismissal();
  const update = useUpdateDismissal(initial?.id ?? '');

  const form = useForm<FormValues>({
    initialValues: {
      dismissedAt: initial?.dismissedAt ? new Date(initial.dismissedAt) : new Date(),
      reason: initial?.reasonCode ?? initial?.reason ?? '',
      notes: initial?.notes ?? '',
    },
    validate: {
      dismissedAt: (v) => (v ? null : t('dismissals.form.reasonRequired')),
      reason: (v) => (v.trim() ? null : t('dismissals.form.reasonRequired')),
    },
  });

  function handleSubmit(values: FormValues) {
    if (!values.dismissedAt) return;
    // Both columns get the CODE, never a localized label. `reason` is NOT
    // NULL in the schema so it cannot simply be dropped, and storing the label
    // there is what made the same dismissal read "Stan zdrowia" to a Polish
    // recruiter and to a Ukrainian one alike: whoever recorded it froze the
    // language. Labels are resolved at render time from status_lookups
    // instead, per viewer.
    const code = values.reason.trim();
    const payload: CreateDismissalInput = {
      candidateId,
      dismissedAt: values.dismissedAt.toISOString(),
      reason: code,
      reasonCode: code,
      notes: values.notes.trim() || null,
    };

    if (initial) {
      update.mutate(
        {
          patch: {
            reason: payload.reason,
            reasonCode: payload.reasonCode,
            dismissedAt: payload.dismissedAt,
            notes: payload.notes,
          },
          candidateId,
        },
        {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('dismissals.form.saved') });
            onClose();
          },
          onError: (err: unknown) => {
            notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
          },
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('dismissals.form.created') });
          form.reset();
          onClose();
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      });
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initial ? t('dismissals.form.editTitle') : t('dismissals.form.createTitle')}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          {/* Date-only per client request 2026-07-04. */}
          <DateInput
            label={t('dismissals.fields.dismissedAt')}
            valueFormat="DD.MM.YYYY"
            required
            {...form.getInputProps('dismissedAt')}
          />
          {/* Same control the candidate form has used since 2026-06 — picking
              from the taxonomy, with "+ Dodaj nową" for anything missing, so
              the dictionary grows instead of the data fragmenting. */}
          <LookupSelect
            type="dismissal_reason"
            label={t('dismissals.fields.reason')}
            placeholder={t('dismissals.fields.reasonPlaceholder')}
            value={form.values.reason || null}
            onChange={(v) => form.setFieldValue('reason', v ?? '')}
            error={form.errors.reason}
            required
          />
          <Textarea
            label={t('dismissals.fields.notes')}
            minRows={2}
            autosize
            {...form.getInputProps('notes')}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              {t('dismissals.form.cancel')}
            </Button>
            <Button type="submit" loading={isPending}>
              {t('dismissals.form.submit')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
