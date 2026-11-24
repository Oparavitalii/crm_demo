import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useCancelCandidate } from './api';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { useIsMobile } from '@/lib/use-is-mobile';

interface Props {
  opened: boolean;
  onClose: () => void;
  candidateId: string;
  onSuccess?: () => void;
}

// 2026-06-10: cancel_reason_code column was dropped on the candidates table.
// The modal still surfaces the canonical reason list as a discoverability
// helper, but the submitted payload only carries `reasonNote` — we serialize
// "code: optional free text" into a single string so the analytics layer can
// still group on the prefix while the user keeps the freedom to add detail.
export function CancelModal({ opened, onClose, candidateId, onSuccess }: Props) {
  const { t, i18n } = useTranslation(['candidates', 'errors']);
  const isMobile = useIsMobile();
  const cancel = useCancelCandidate(candidateId);
  const apiErrorMessage = useApiErrorMessage();
  // 2026-06-13: reason options come from status_lookups('no_show_reason')
  // (admin-editable at /admin/settings/statuses → "Przyczyny odmów") instead
  // of the legacy hardcoded CANCEL_REASONS list. The lookup type code is
  // still `no_show_reason` for back-compat with the existing DB rows; the UI
  // label was renamed to "Przyczyny odmów / Причини відміни" to reflect the
  // current purpose.
  const { data: reasonLookup } = useStatusLookup('no_show_reason');
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const reasonOptions = (reasonLookup ?? []).map((r) => ({
    value: r.code,
    label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
  }));

  function submit() {
    // 2026-07-02 — reason fully optional (every field independent). Serialize
    // "code", "code: free text", bare free text, or nothing at all. Backend
    // persists this verbatim in candidates.reason_note (max 2000) and routes
    // status='cancelled' regardless of the prefix.
    const trimmedNote = note.trim();
    const reasonNote = code
      ? trimmedNote
        ? `${code}: ${trimmedNote}`
        : code
      : trimmedNote || undefined;
    cancel.mutate(
      { reasonNote },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: t('cancel.success'),
          });
          onClose();
          onSuccess?.();
        },
        onError: (err) => {
          const { code: errCode } = parseApiError(err);
          notifications.show({
            color: 'red',
            message: errCode === 'FORBIDDEN' ? t('errors:noPermission') : apiErrorMessage(err),
            autoClose: 8000,
          });
        },
      },
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('cancel.title')} size="md" fullScreen={isMobile}>
      <Stack>
        <Select
          label={t('cancel.reason')}
          data={reasonOptions}
          value={code}
          onChange={(v) => setCode(v)}
          searchable
          clearable
        />
        <Textarea
          label={t('cancel.note')}
          description={t('cancel.noteOptional')}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          minRows={3}
          maxLength={200}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button
            color={code === 'blacklist' ? 'dark' : 'orange'}
            onClick={submit}
            loading={cancel.isPending}
          >
            {code === 'blacklist' ? t('cancel.submitBlacklist') : t('cancel.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
