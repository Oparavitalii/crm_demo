import { useState } from 'react';
import { Autocomplete, Button, Group, Modal, Stack, Textarea } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useDismissCandidate } from './api';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';

interface Props {
  opened: boolean;
  onClose: () => void;
  candidateId: string;
  onSuccess?: () => void;
}

// Lifecycle dismiss — calls /candidates/:id/dismiss which closes the open
// employment_period AND flips status to 'dismissed'. Separate from the legacy
// DismissalFormModal (which writes to the `dismissals` table for retention
// reports). When this modal becomes the canonical flow we can fold dismissals
// row creation into the backend service.
export function DismissModal({ opened, onClose, candidateId, onSuccess }: Props) {
  const { t, i18n } = useTranslation(['candidates', 'operations', 'errors']);
  const dismiss = useDismissCandidate(candidateId);
  const apiErrorMessage = useApiErrorMessage();
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');
  const [workEndDate, setWorkEndDate] = useState<Date | null>(new Date());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  // Mantine v7 Autocomplete stores the visible label, not `value`. We feed it
  // string labels and reverse-map back to the canonical code on submit so the
  // DB never gets the localized label as a reason code (legacy bug — see
  // 2026-06-13 backfill of `Pracownik zrezygnował`/`Повернувся додому`).
  const labelToCode = new Map<string, string>();
  const reasonOptions: string[] = [];
  for (const r of reasonLookup ?? []) {
    const label = i18n.language === 'pl' ? r.labelPl : r.labelUa;
    labelToCode.set(label, r.code);
    reasonOptions.push(label);
  }

  function submit() {
    if (!workEndDate) {
      notifications.show({
        color: 'red',
        message: t('dismiss.dateRequired', { defaultValue: 'Вкажіть дату звільнення' }),
      });
      return;
    }
    // 2026-07-02 — reason is optional (every field independent). If the user
    // picked an option from the dropdown, `reason` holds its localized label —
    // map back to the canonical code. Free-text custom values pass through.
    const trimmed = reason.trim();
    const reasonCode = trimmed ? labelToCode.get(trimmed) ?? trimmed : undefined;
    dismiss.mutate(
      {
        workEndDate: workEndDate.toISOString(),
        reasonCode,
        reasonNote: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('dismiss.success', { defaultValue: 'Звільнено' }) });
          onClose();
          onSuccess?.();
        },
        onError: (err) => {
          const { code, meta } = parseApiError(err);
          notifications.show({
            color: 'red',
            message:
              code === 'VALIDATION' && meta?.reason === 'not_a_client'
                ? t('dismiss.notAClient', { defaultValue: 'Не клієнт' })
                : apiErrorMessage(err),
            autoClose: 8000,
          });
        },
      },
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('dismiss.title', { defaultValue: 'Звільнити' })} size="md">
      <Stack>
        {/* Date-only per client request 2026-07-04 — the hour carried no
            business meaning and confused users. */}
        <DateInput
          label={t('dismiss.dismissedAt', { defaultValue: 'Дата звільнення' })}
          valueFormat="DD.MM.YYYY"
          value={workEndDate}
          onChange={(v) => setWorkEndDate(v ? new Date(v) : null)}
          required
        />
        <Autocomplete
          label={t('dismiss.reason', { defaultValue: 'Причина' })}
          placeholder={t('operations:dismissals.fields.reasonPlaceholder')}
          data={reasonOptions}
          value={reason}
          onChange={setReason}
        />
        <Textarea
          label={t('dismiss.note', { defaultValue: 'Коментар' })}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          minRows={2}
          autosize
          maxLength={2000}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button color="red" onClick={submit} loading={dismiss.isPending}>
            {t('dismiss.submit', { defaultValue: 'Звільнити' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
