import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import type { Candidate } from '@opushr/shared';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useBulkConsentRequest } from './api';

// Bulk "send consent requests" confirm dialog. One POST /candidates/consent-requests
// mails a confirm/manage link to every selected candidate that has an email;
// the response summarizes { sent, skippedNoEmail, failed }. The backend caps the
// batch at 100 ids, so we block (rather than silently truncate) larger selections.
const MAX_BATCH = 100;

export function BulkConsentModal({
  opened,
  onClose,
  selected,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  selected: Candidate[];
  onDone: () => void;
}) {
  const { t } = useTranslation(['candidates', 'common', 'errors']);
  const bulk = useBulkConsentRequest();
  const apiErrorMessage = useApiErrorMessage();
  const tooMany = selected.length > MAX_BATCH;

  function run() {
    if (tooMany || selected.length === 0) return;
    bulk.mutate(
      { candidateIds: selected.map((c) => c.id) },
      {
        onSuccess: (res) => {
          notifications.show({
            color: res.failed > 0 ? 'yellow' : 'green',
            message: t('bulk.consentRequest.result', {
              defaultValue: 'Wysłano: {{sent}}, bez e-maila: {{skipped}}, błędów: {{failed}}',
              sent: res.sent,
              skipped: res.skippedNoEmail,
              failed: res.failed,
            }),
          });
          onDone();
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={bulk.isPending ? () => undefined : onClose}
      title={t('bulk.consentRequest.title', { defaultValue: 'Wyślij prośby o zgodę' })}
      centered
    >
      <Stack>
        <Text size="sm">
          {t('bulk.consentRequest.confirm', {
            defaultValue:
              'Wysłać e-mail z linkiem do potwierdzenia zgody do {{count}} kandydatów? Kandydaci bez adresu e-mail zostaną pominięci.',
            count: selected.length,
          })}
        </Text>
        {tooMany && (
          <Alert color="red" variant="light">
            {t('bulk.consentRequest.tooMany', {
              defaultValue: 'Maksymalnie {{max}} naraz. Zmniejsz zaznaczenie.',
              max: MAX_BATCH,
            })}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={bulk.isPending}>
            {t('common:actions.cancel', { defaultValue: 'Anuluj' })}
          </Button>
          <Button color="grape" onClick={run} loading={bulk.isPending} disabled={tooMany}>
            {t('bulk.consentRequest.submit', { defaultValue: 'Wyślij' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
