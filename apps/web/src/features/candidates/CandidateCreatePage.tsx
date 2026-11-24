import { Container, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CreateCandidateInput, DuplicateMatch } from '@crm/shared';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useCreateCandidate } from './api';
import { CandidateForm } from './CandidateForm';
import { DuplicateWarning } from './DuplicateWarning';

export function CandidateCreatePage() {
  const { t } = useTranslation(['candidates', 'errors']);
  const navigate = useNavigate();
  const create = useCreateCandidate();
  const isMobile = useIsMobile();
  const apiErrorMessage = useApiErrorMessage();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [pendingInput, setPendingInput] = useState<CreateCandidateInput | null>(null);

  function submit(values: CreateCandidateInput, force = false) {
    setPendingInput(values);
    create.mutate(
      { input: values, force },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('form.created') });
          navigate('/candidates');
        },
        onError: (err: unknown) => {
          const info = parseApiError(err);
          if (info.status === 409 && info.code === 'DUPLICATE') {
            const dups = (info.meta?.duplicates as DuplicateMatch[] | undefined) ?? [];
            setDuplicates(dups);
            return;
          }
          // Surface the backend's error code + meta (or a network/offline
          // explanation) so we can see *why* the submit failed instead of a
          // generic "something went wrong".
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  return (
    <Container size="md">
      <Title order={isMobile ? 3 : 2} mb={isMobile ? 'xs' : 'md'} data-reveal>{t('form.createTitle')}</Title>
      <Paper
        {...(isMobile
          ? ({ p: 'md', shadow: 'none', radius: 0 } as const)
          : ({ withBorder: true, shadow: 'sm', p: 'lg', radius: 'md' } as const))}
        data-reveal
      >
        <CandidateForm
          onSubmit={(values) => submit(values, false)}
          submitting={create.isPending}
          submitLabel={t('form.submitCreate')}
          onCancel={() => navigate('/candidates')}
        />
      </Paper>
      <DuplicateWarning
        duplicates={duplicates}
        onCancel={() => setDuplicates(null)}
        onCreateAnyway={() => {
          setDuplicates(null);
          if (pendingInput) submit(pendingInput, true);
        }}
      />
    </Container>
  );
}
