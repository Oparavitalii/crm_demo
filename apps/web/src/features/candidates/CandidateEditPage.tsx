import { Container, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { Candidate } from '@crm/shared';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useCandidate, useUpdateCandidate } from './api';
import { CandidateForm } from './CandidateForm';
import { Splash } from '@/components/Splash';

function CandidateEditInner({ candidate: c }: { candidate: Candidate }) {
  const { t } = useTranslation(['candidates', 'errors']);
  const navigate = useNavigate();
  const update = useUpdateCandidate(c.id);
  const isMobile = useIsMobile();
  const apiErrorMessage = useApiErrorMessage();

  return (
    <Container size="md">
      <Title order={isMobile ? 3 : 2} mb={isMobile ? 'xs' : 'md'} data-reveal>{t('form.editTitle')}</Title>
      <Paper
        {...(isMobile
          ? ({ p: 'md', shadow: 'none', radius: 0 } as const)
          : ({ withBorder: true, shadow: 'sm', p: 'lg', radius: 'md' } as const))}
        data-reveal
      >
        <CandidateForm
          initial={{
            name: c.name,
            email: c.email,
            phone: c.phone,
            birthDate: c.birthDate,
            nationality: c.nationality,
            status: c.status,
            source: c.source,
            notes: c.notes,
            recruiterId: c.recruiterId ?? undefined,
            coordinatorId: c.coordinatorId,
            projectId: c.projectId,
            freelancerId: c.freelancerId,
            housingType: c.housingType,
            workStartDate: c.workStartDate,
            workEndDate: c.workEndDate,
            workEndReason: c.workEndReason,
            reasonNote: c.reasonNote,
            position: c.position,
            legalStatus: c.legalStatus,
            reconciliationPeriod: c.reconciliationPeriod,
            documentsSubmittedAt: c.documentsSubmittedAt,
            arrivedAt: c.arrivedAt,
            workOutcome: c.workOutcome,
            payoutStatus: c.payoutStatus,
            paymentStatus: c.paymentStatus,
            retention: c.retention,
            messenger: c.messenger,
            experience: c.experience,
          }}
          // 2026-07-10 — PATCH only the changed fields. Untouched legacy values
          // (imported phones/emails that predate today's validation) are never
          // re-sent, so editing one field can't be blocked by another one.
          onSubmit={(_values, changed) => {
            if (Object.keys(changed).length === 0) {
              notifications.show({
                color: 'gray',
                message: t('form.noChanges', { defaultValue: 'Немає змін для збереження' }),
              });
              navigate(`/candidates/${c.id}`);
              return;
            }
            update.mutate(changed, {
              onSuccess: () => {
                notifications.show({ color: 'green', message: t('form.saved') });
                navigate(`/candidates/${c.id}`);
              },
              // Surface the backend's error code + meta (e.g. reason_required)
              // or a network/offline explanation — a silent failure here reads
              // as "the Save button does nothing" to the user.
              onError: (err: unknown) => {
                notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
              },
            });
          }}
          submitting={update.isPending}
          submitLabel={t('form.submitSave')}
          onCancel={() => navigate(`/candidates/${c.id}`)}
        />
      </Paper>
    </Container>
  );
}

export function CandidateEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: candidate, isPending } = useCandidate(id);
  if (isPending || !candidate) return <Splash />;
  return <CandidateEditInner candidate={candidate} />;
}
