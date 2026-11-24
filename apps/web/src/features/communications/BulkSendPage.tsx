import { Alert, Button, Container, Group, Paper, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  CANDIDATE_STATUSES,
  type CandidateStatus,
} from '@opushr/shared';
import { parseApiError, apiFetch } from '@/lib/http';
import { useAuthStore } from '@/lib/auth-store';
import { useAdminUsers } from '@/features/admin-users/api';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { useTemplates, useBulkSend } from './api';
import { ConsentCampaignModal } from './ConsentCampaignModal';
import type { PreviewRecipientsResponse, BulkSendResponse } from '@opushr/shared';

export function BulkSendPage() {
  const { t, i18n } = useTranslation(['communications', 'candidates', 'errors']);
  const { data: sourcesLookup } = useStatusLookup('sources');
  const role = useAuthStore((s) => s.user?.role);
  const qc = useQueryClient();

  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [status, setStatus] = useState<CandidateStatus | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [recruiterId, setRecruiterId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRecipientsResponse | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [result, setResult] = useState<BulkSendResponse | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { data: templatesData } = useTemplates({ channel, pageSize: 100 });
  const { data: usersData } = useAdminUsers({ pageSize: 100, role: 'recruiter' }, { enabled: role === 'admin' });
  const bulkSend = useBulkSend();

  const templates = templatesData?.items ?? [];
  const recruiters = usersData?.items ?? [];

  // Consent breakdown (SMS): `consented` receive under the default send;
  // `withoutConsent` are extra phone-holders with no digital consent that an
  // admin may reach via the override. total = consented + withoutConsent.
  const consented = preview?.count ?? 0;
  const withoutConsent = preview?.withoutConsent ?? 0;
  const totalAll = consented + withoutConsent;
  const smsOverrideAvailable = channel === 'sms' && role === 'admin' && withoutConsent > 0;

  function handleChannelChange(value: string) {
    setChannel(value as 'email' | 'sms');
    // Template list and audience are channel-specific — force a re-pick.
    setTemplateId(null);
    setPreview(null);
    setResult(null);
  }

  async function handlePreview() {
    setIsPreviewing(true);
    setPreview(null);
    try {
      const filters: Record<string, string> = { channel };
      if (status) filters.status = status;
      if (source) filters.source = source;
      if (recruiterId) filters.recruiterId = recruiterId;

      const res = await apiFetch<PreviewRecipientsResponse>('/communications/preview-recipients', {
        method: 'GET',
        query: filters,
      });
      setPreview(res);
    } catch {
      notifications.show({ color: 'red', message: t('errors:generic') });
    } finally {
      setIsPreviewing(false);
    }
  }

  function handleSend(dryRun = false, includeWithoutConsent = false) {
    if (!templateId) return;
    bulkSend.mutate(
      {
        templateId,
        entityType: 'candidate',
        filters: {
          status: status ?? undefined,
          source: source ?? undefined,
          recruiterId: recruiterId ?? undefined,
        },
        includeWithoutConsent,
        dryRun,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          void qc.invalidateQueries({ queryKey: ['comms-history'] });
          if (dryRun) {
            notifications.show({
              color: 'blue',
              message: t('communications:bulkSend.step4.resultDryRun', { count: res.recipientsTotal }),
            });
          } else if (res.sentWithoutConsent > 0) {
            notifications.show({
              color: 'green',
              message: t('communications:bulkSend.step4.resultSuccessOverride', {
                sent: res.sentCount,
                failed: res.failedCount,
                withoutConsent: res.sentWithoutConsent,
              }),
            });
          } else {
            notifications.show({
              color: 'green',
              message: t('communications:bulkSend.step4.resultSuccess', {
                sent: res.sentCount,
                failed: res.failedCount,
              }),
            });
          }
        },
        onError: (err: unknown) => {
          const { code, meta } = parseApiError(err);
          if (code === 'TOO_MANY_RECIPIENTS') {
            notifications.show({
              color: 'red',
              message: t('communications:bulkSend.errors.tooManyRecipients', {
                count: (meta?.count as number) ?? 0,
              }),
            });
          } else {
            notifications.show({ color: 'red', message: t('communications:bulkSend.errors.sendFailed') });
          }
        },
      },
    );
  }

  const canSend = !!templateId && preview !== null && consented > 0 && consented <= 100;

  return (
    <Container size="md">
      <Group justify="space-between" mb="lg" data-reveal>
        <Title order={2}>{t('communications:bulkSend.title')}</Title>
        <Button variant="light" onClick={() => setCampaignOpen(true)}>
          {t('communications:consentCampaign.button')}
        </Button>
      </Group>

      <ConsentCampaignModal opened={campaignOpen} onClose={() => setCampaignOpen(false)} />

      <Stack>
        {/* Step 1: Pick channel + template */}
        <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
          <Text fw={600} mb="sm">{t('communications:bulkSend.step1.title')}</Text>
          <Stack>
            <SegmentedControl
              value={channel}
              onChange={handleChannelChange}
              data={[
                { value: 'email', label: t('communications:templates.channel.email') },
                { value: 'sms', label: t('communications:templates.channel.sms') },
              ]}
            />
            <Select
              placeholder={t('communications:bulkSend.step1.placeholder')}
              data={templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.name }))}
              value={templateId}
              onChange={(v) => { setTemplateId(v); setPreview(null); setResult(null); }}
              searchable
              clearable
            />
            {channel === 'sms' && (
              <Text size="xs" c="dimmed">
                {t('communications:bulkSend.step1.smsHint')}
              </Text>
            )}
          </Stack>
        </Paper>

        {/* Step 2: Filters */}
        <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
          <Text fw={600} mb="sm">{t('communications:bulkSend.step2.title')}</Text>
          <Stack>
            <Select
              placeholder={t('communications:bulkSend.step2.allStatuses')}
              data={CANDIDATE_STATUSES.map((s) => ({ value: s, label: t(`candidates:status.${s}`) }))}
              value={status}
              onChange={(v) => { setStatus(v as CandidateStatus | null); setPreview(null); }}
              clearable
            />
            <Select
              placeholder={t('communications:bulkSend.step2.allSources')}
              data={(sourcesLookup ?? []).map((r) => ({
                value: r.code,
                label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
              }))}
              value={source}
              onChange={(v) => { setSource(v); setPreview(null); }}
              clearable
            />
            {role === 'admin' && (
              <Select
                placeholder={t('communications:bulkSend.step2.allRecruiters')}
                data={recruiters.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))}
                value={recruiterId}
                onChange={(v) => { setRecruiterId(v); setPreview(null); }}
                clearable
                searchable
              />
            )}
          </Stack>
        </Paper>

        {/* Step 3: Preview */}
        <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
          <Text fw={600} mb="sm">{t('communications:bulkSend.step3.title')}</Text>
          <Group>
            <Button
              variant="outline"
              onClick={() => void handlePreview()}
              loading={isPreviewing}
              disabled={!templateId}
            >
              {t('communications:bulkSend.step3.previewBtn')}
            </Button>
          </Group>
          {preview !== null && (
            channel === 'sms' && withoutConsent > 0 ? (
              <Alert mt="sm" color="yellow">
                {t('communications:bulkSend.step3.smsBreakdown', { consented, withoutConsent })}
                {role !== 'admin' && ` ${t('communications:bulkSend.step3.overrideAdminOnly')}`}
              </Alert>
            ) : (
              <Alert
                mt="sm"
                color={consented === 0 ? 'yellow' : consented > 100 ? 'red' : 'green'}
              >
                {consented === 0
                  ? t('communications:bulkSend.step3.noRecipients')
                  : consented > 100
                    ? t('communications:bulkSend.step3.tooMany', { count: consented })
                    : t('communications:bulkSend.step3.count', { count: consented })}
              </Alert>
            )
          )}
        </Paper>

        {/* Step 4: Send */}
        <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
          <Text fw={600} mb="sm">{t('communications:bulkSend.step4.title')}</Text>
          <Group>
            {smsOverrideAvailable ? (
              <>
                <Button
                  color="red"
                  onClick={() => handleSend(false, true)}
                  loading={bulkSend.isPending}
                  disabled={totalAll === 0 || totalAll > 100}
                >
                  {t('communications:bulkSend.step4.sendAllBtn', { count: totalAll })}
                </Button>
                <Button
                  variant="light"
                  onClick={() => handleSend(false, false)}
                  loading={bulkSend.isPending}
                  disabled={consented === 0 || consented > 100}
                >
                  {t('communications:bulkSend.step4.sendConsentedBtn', { count: consented })}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => handleSend(false, false)}
                loading={bulkSend.isPending}
                disabled={!canSend}
              >
                {t('communications:bulkSend.step4.sendBtn', { count: consented })}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => handleSend(true, false)}
              loading={bulkSend.isPending}
              disabled={!templateId || preview === null}
            >
              {t('communications:bulkSend.step4.dryRunBtn')}
            </Button>
          </Group>

          {result && (
            <Alert mt="sm" color={result.dryRun ? 'blue' : 'green'}>
              {result.dryRun
                ? t('communications:bulkSend.step4.resultDryRun', { count: result.recipientsTotal })
                : result.sentWithoutConsent > 0
                  ? t('communications:bulkSend.step4.resultSuccessOverride', {
                      sent: result.sentCount,
                      failed: result.failedCount,
                      withoutConsent: result.sentWithoutConsent,
                    })
                  : t('communications:bulkSend.step4.resultSuccess', {
                      sent: result.sentCount,
                      failed: result.failedCount,
                    })}
            </Alert>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
