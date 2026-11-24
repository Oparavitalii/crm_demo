import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Switch, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Mail, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Candidate } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useAdminSetConsent, useSendConsentRequest } from './api';

// Detail-card consent block: shows the current active-consent flags
// (RODO / email / sms) and drives re-consent. The primary action emails the
// candidate a confirm/manage link — the operator never sees it, so they cannot
// self-approve. Admins additionally get a direct override modal (audited).
// Extracted from CandidateDetailPage to keep that file under the 200-line budget.
export function CandidateConsentSection({ candidate: c }: { candidate: Candidate }) {
  const { t } = useTranslation('candidates');
  const apiErrorMessage = useApiErrorMessage();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';

  const send = useSendConsentRequest(c.id);
  const adminSet = useAdminSetConsent(c.id);

  const rodoOn = c.rodoConsent ?? false;
  const emailOn = c.emailConsent ?? false;
  const smsOn = c.smsConsent ?? false;
  const hasEmail = Boolean(c.email);

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState(emailOn);
  const [sms, setSms] = useState(smsOn);

  function openAdminModal() {
    // Prefill the switches from the candidate's CURRENT state each time it opens.
    setEmail(emailOn);
    setSms(smsOn);
    setModalOpen(true);
  }

  function handleSend() {
    send.mutate(undefined, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t('consent.sendSuccess') });
      },
      onError: (err: unknown) => {
        // Graceful message for the (race) case where the candidate lost their
        // email between render and click — the button is disabled otherwise.
        const { meta } = parseApiError(err);
        const message =
          meta?.reason === 'candidate_has_no_email' ? t('consent.noEmail') : apiErrorMessage(err);
        notifications.show({ color: 'red', message, autoClose: 8000 });
      },
    });
  }

  function handleAdminSave() {
    adminSet.mutate(
      { email, sms },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('consent.adminSaved') });
          setModalOpen(false);
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm">
      <Stack>
        <Title order={4}>{t('consent.sectionTitle')}</Title>
        <Group gap="sm">
          <Badge color={rodoOn ? 'green' : 'red'} variant={rodoOn ? 'filled' : 'light'}>
            {`${t('consent.rodoShort')} ${rodoOn ? '✓' : '✗'}`}
          </Badge>
          <Badge color={emailOn ? 'green' : 'gray'} variant={emailOn ? 'filled' : 'light'}>
            {`${t('consent.emailShort')} ${emailOn ? '✓' : '✗'}`}
          </Badge>
          <Badge color={smsOn ? 'green' : 'gray'} variant={smsOn ? 'filled' : 'light'}>
            {`${t('consent.smsShort')} ${smsOn ? '✓' : '✗'}`}
          </Badge>
        </Group>
        {/* Sending / changing consent is admin-only — non-admins see status only. */}
        {isAdmin && (
          <Group>
            {/* Tooltip needs a real hoverable node when the button is disabled —
                a disabled <button> swallows pointer events, so wrap it in a span. */}
            <Tooltip label={t('consent.noEmail')} disabled={hasEmail}>
              <span>
                <Button
                  variant="light"
                  leftSection={<Mail size={16} />}
                  loading={send.isPending}
                  disabled={!hasEmail}
                  onClick={handleSend}
                >
                  {t('consent.sendButton')}
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="default"
              leftSection={<ShieldCheck size={16} />}
              onClick={openAdminModal}
            >
              {t('consent.adminButton')}
            </Button>
          </Group>
        )}
      </Stack>

      {isAdmin && (
        <Modal
          opened={modalOpen}
          onClose={() => setModalOpen(false)}
          title={t('consent.adminButton')}
        >
          <Stack>
            <Text size="xs" c="dimmed">
              {t('consent.adminCaption')}
            </Text>
            <Switch
              label={t('consent.email')}
              checked={email}
              onChange={(e) => setEmail(e.currentTarget.checked)}
            />
            <Switch
              label={t('consent.sms')}
              checked={sms}
              onChange={(e) => setSms(e.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setModalOpen(false)}>
                {t('form.cancel')}
              </Button>
              <Button onClick={handleAdminSave} loading={adminSet.isPending}>
                {t('consent.adminSave')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Paper>
  );
}
