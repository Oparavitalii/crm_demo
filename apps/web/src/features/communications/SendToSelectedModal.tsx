import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { apiFetch, parseApiError } from '@/lib/http';
import { useAuthStore } from '@/lib/auth-store';
import type { PreviewRecipientsResponse } from '@opushr/shared';
import { useBulkSend, useTemplates } from './api';

interface Props {
  opened: boolean;
  onClose: () => void;
  entityType: 'candidate';
  // Selected row IDs from the parent list. Modal shows the count + lets admin
  // pick a template + confirm before the bulk send fires.
  recipientIds: string[];
}

export function SendToSelectedModal({ opened, onClose, entityType, recipientIds }: Props) {
  const { t } = useTranslation(['communications', 'common', 'errors']);
  const role = useAuthStore((s) => s.user?.role);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRecipientsResponse | null>(null);
  const { data: templatesData } = useTemplates({ channel, pageSize: 100 });
  const bulkSend = useBulkSend();

  const templates = templatesData?.items ?? [];
  const idsKey = recipientIds.join(',');

  // Consent breakdown for the exact selected rows — drives the warning + the
  // admin "send to all" override. Both channels are now consent-gated (email on
  // email_marketing, sms on sms_marketing), so we always fetch it: it's what
  // tells the operator WHY some (or all) recipients won't be sent to.
  useEffect(() => {
    if (!opened || idsKey === '') {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<PreviewRecipientsResponse>('/communications/preview-recipients', {
          method: 'GET',
          query: { channel, recipientIds: idsKey },
        });
        if (!cancelled) setPreview(res);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, channel, idsKey]);

  const consented = preview?.count ?? 0;
  const withoutConsent = preview?.withoutConsent ?? 0;
  const totalAll = consented + withoutConsent;
  const overrideAvailable = role === 'admin' && withoutConsent > 0;
  // Preview loaded and nobody among the selection has consent → normal send
  // would deliver nothing. Block it and explain why (unless admin overrides).
  const noneConsented = preview !== null && consented === 0;

  function handleChannelChange(value: string) {
    setChannel(value as 'email' | 'sms');
    setTemplateId(null);
  }

  function handleSend(dryRun = false, includeWithoutConsent = false) {
    if (!templateId || recipientIds.length === 0) return;
    bulkSend.mutate(
      {
        templateId,
        entityType,
        recipientIds,
        filters: {},
        includeWithoutConsent,
        dryRun,
      },
      {
        onSuccess: (res) => {
          if (dryRun) {
            notifications.show({
              color: 'blue',
              message: t('communications:bulkSend.step4.resultDryRun', {
                count: res.recipientsTotal,
              }),
            });
          } else if (res.recipientsTotal === 0) {
            // Nothing went out — explain WHY (no active consent among selection).
            notifications.show({
              color: 'yellow',
              message: t('communications:bulkSend.step4.resultNone', {
                defaultValue:
                  'Nikomu nie wysłano — żaden z zaznaczonych nie ma aktywnej zgody na ten kanał.',
              }),
            });
            setTemplateId(null);
            onClose();
          } else {
            notifications.show({
              color: 'green',
              message:
                res.sentWithoutConsent > 0
                  ? t('communications:bulkSend.step4.resultSuccessOverride', {
                      sent: res.sentCount,
                      failed: res.failedCount,
                      withoutConsent: res.sentWithoutConsent,
                    })
                  : t('communications:bulkSend.step4.resultSuccess', {
                      sent: res.sentCount,
                      failed: res.failedCount,
                    }),
            });
            setTemplateId(null);
            onClose();
          }
        },
        onError: (err: unknown) => {
          const { code, meta } = parseApiError(err);
          const msg =
            code === 'TOO_MANY_RECIPIENTS'
              ? t('communications:bulkSend.errors.tooManyRecipients', {
                  count: (meta?.count as number) ?? 0,
                })
              : t('communications:bulkSend.errors.sendFailed');
          notifications.show({ color: 'red', message: msg });
        },
      },
    );
  }

  const noTemplate = !templateId || recipientIds.length === 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('communications:sendToSelected.title')}
      size="md"
    >
      <Stack>
        <Alert color="blue">
          {t('communications:sendToSelected.count', {
            defaultValue: 'Zaznaczonych odbiorców: {{count}}',
            count: recipientIds.length,
          })}
        </Alert>

        <SegmentedControl
          value={channel}
          onChange={handleChannelChange}
          data={[
            { value: 'email', label: t('communications:templates.channel.email') },
            { value: 'sms', label: t('communications:templates.channel.sms') },
          ]}
        />

        <Select
          label={t('communications:bulkSend.step1.title')}
          placeholder={t('communications:bulkSend.step1.placeholder')}
          data={templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.name }))}
          value={templateId}
          onChange={setTemplateId}
          searchable
          required
        />

        {preview !== null && withoutConsent > 0 && (
          <Alert color={noneConsented ? 'red' : 'yellow'}>
            {t('communications:sendToSelected.consentBreakdown', {
              defaultValue:
                'Ze zgodą: {{consented}}. Bez zgody: {{withoutConsent}} — do nich nie wyślemy (brak aktywnej zgody).',
              consented,
              withoutConsent,
            })}
            {role !== 'admin' && ` ${t('communications:bulkSend.step3.overrideAdminOnly')}`}
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          {channel === 'sms'
            ? t('communications:sendToSelected.hintSms')
            : t('communications:sendToSelected.hintEmail', {
                defaultValue:
                  'E-mail trafi tylko do odbiorców z aktywną zgodą e-mail — pozostali są pomijani. Maks. 100 odbiorców.',
              })}
        </Text>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSend(true, false)}
            disabled={noTemplate}
            loading={bulkSend.isPending}
          >
            {t('communications:bulkSend.step4.dryRunBtn')}
          </Button>
          {overrideAvailable ? (
            <>
              <Button
                variant="light"
                onClick={() => handleSend(false, false)}
                disabled={noTemplate || consented === 0}
                loading={bulkSend.isPending}
              >
                {t('communications:bulkSend.step4.sendConsentedBtn', { count: consented })}
              </Button>
              <Button
                color="red"
                onClick={() => handleSend(false, true)}
                disabled={noTemplate || totalAll === 0}
                loading={bulkSend.isPending}
              >
                {t('communications:bulkSend.step4.sendAllBtn', { count: totalAll })}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => handleSend(false, false)}
              disabled={noTemplate || noneConsented}
              loading={bulkSend.isPending}
            >
              {t('communications:bulkSend.step4.sendBtn', {
                count: preview !== null ? consented : recipientIds.length,
              })}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
