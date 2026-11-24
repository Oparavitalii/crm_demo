import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import {
  CANDIDATE_STATUSES,
  type CandidateStatus,
  type ConsentCampaignResponse,
} from '@crm/shared';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useAuthStore } from '@/lib/auth-store';
import { useAdminUsers } from '@/features/admin-users/api';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { useConsentCampaign, useTemplates } from './api';

interface Props {
  opened: boolean;
  onClose: () => void;
}

// The literal placeholder the template MUST contain — passed as an interpolation
// value so i18next renders the braces verbatim instead of treating them as a
// variable (skipOnVariables is on by default in i18next v23).
const PLACEHOLDER = '{{consentConfirmUrl}}';

export function ConsentCampaignModal({ opened, onClose }: Props) {
  const { t, i18n } = useTranslation(['communications', 'candidates', 'common']);
  const role = useAuthStore((s) => s.user?.role);
  const apiErrorMessage = useApiErrorMessage();
  const { data: sourcesLookup } = useStatusLookup('sources');

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [status, setStatus] = useState<CandidateStatus | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [recruiterId, setRecruiterId] = useState<string | null>(null);
  const [result, setResult] = useState<ConsentCampaignResponse | null>(null);

  const { data: templatesData } = useTemplates({ channel: 'email', pageSize: 100 });
  const { data: usersData } = useAdminUsers(
    { pageSize: 100, role: 'recruiter' },
    { enabled: role === 'admin' },
  );
  const campaign = useConsentCampaign();

  const templates = templatesData?.items ?? [];
  const recruiters = usersData?.items ?? [];

  function resetResult() {
    setResult(null);
  }

  function handleSend(dryRun: boolean) {
    if (!templateId) return;
    campaign.mutate(
      {
        templateId,
        filters: {
          status: status ?? undefined,
          source: source ?? undefined,
          recruiterId: recruiterId ?? undefined,
        },
        dryRun,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          notifications.show({
            color: dryRun ? 'blue' : 'green',
            message: dryRun
              ? t('consentCampaign.resultDryRun', { count: res.recipientsTotal })
              : t('consentCampaign.resultSuccess', {
                  sent: res.sentCount,
                  skipped: res.skippedAlreadyConsented,
                }),
          });
        },
        onError: (err: unknown) => {
          const { code, meta } = parseApiError(err);
          const missingUrl =
            code === 'VALIDATION' && meta?.reason === 'template_missing_consent_confirm_url';
          notifications.show({
            color: 'red',
            autoClose: 8000,
            message: missingUrl
              ? t('consentCampaign.errors.missingPlaceholder', { code: PLACEHOLDER })
              : apiErrorMessage(err),
          });
        },
      },
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('consentCampaign.title')} size="md">
      <Stack>
        <Text size="sm" c="dimmed">
          {t('consentCampaign.intro')}
        </Text>
        <Alert color="blue" variant="light">
          {t('consentCampaign.placeholderHint', { code: PLACEHOLDER })}
        </Alert>

        <Select
          label={t('consentCampaign.template')}
          placeholder={t('bulkSend.step1.placeholder')}
          data={templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.name }))}
          value={templateId}
          onChange={(v) => {
            setTemplateId(v);
            resetResult();
          }}
          searchable
          required
        />
        <Select
          label={t('consentCampaign.status')}
          placeholder={t('bulkSend.step2.allStatuses')}
          data={CANDIDATE_STATUSES.map((s) => ({ value: s, label: t(`candidates:status.${s}`) }))}
          value={status}
          onChange={(v) => {
            setStatus(v as CandidateStatus | null);
            resetResult();
          }}
          clearable
        />
        <Select
          label={t('consentCampaign.source')}
          placeholder={t('bulkSend.step2.allSources')}
          data={(sourcesLookup ?? []).map((r) => ({
            value: r.code,
            label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
          }))}
          value={source}
          onChange={(v) => {
            setSource(v);
            resetResult();
          }}
          clearable
        />
        {role === 'admin' && (
          <Select
            label={t('consentCampaign.recruiter')}
            placeholder={t('bulkSend.step2.allRecruiters')}
            data={recruiters.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))}
            value={recruiterId}
            onChange={(v) => {
              setRecruiterId(v);
              resetResult();
            }}
            clearable
            searchable
          />
        )}

        {result && (
          <Alert color={result.dryRun ? 'blue' : 'green'}>
            {result.dryRun
              ? t('consentCampaign.resultDryRun', { count: result.recipientsTotal })
              : t('consentCampaign.resultDetail', {
                  total: result.recipientsTotal,
                  sent: result.sentCount,
                  failed: result.failedCount,
                  skipped: result.skippedAlreadyConsented,
                })}
          </Alert>
        )}

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSend(true)}
            disabled={!templateId}
            loading={campaign.isPending}
          >
            {t('bulkSend.step4.dryRunBtn')}
          </Button>
          <Button
            onClick={() => handleSend(false)}
            disabled={!templateId}
            loading={campaign.isPending}
          >
            {t('consentCampaign.send')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
