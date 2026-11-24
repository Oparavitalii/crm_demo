import { useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import type { HireCandidateInput, RehireCandidateInput } from '@crm/shared';
import { ProjectSelect } from '@/features/projects/ProjectSelect';
import { useDirectoryUsers } from '@/features/directory/api';
import { useHireCandidate, useRehireCandidate } from './api';
import { parseApiError } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';

interface Props {
  opened: boolean;
  onClose: () => void;
  candidateId: string;
  mode: 'hire' | 'rehire';
  onSuccess?: () => void;
}

// Single modal serving both first-hire (status: candidate → employed, kind flip)
// and re-hire (dismissed client → re_employed). Body shape is identical; the
// `mode` prop switches the title and the mutation hook used.
export function HireModal({ opened, onClose, candidateId, mode, onSuccess }: Props) {
  const { t } = useTranslation(['candidates', 'errors']);
  const hire = useHireCandidate(candidateId);
  const rehire = useRehireCandidate(candidateId);
  const mutation = mode === 'hire' ? hire : rehire;
  const apiErrorMessage = useApiErrorMessage();

  const [workStartDate, setWorkStartDate] = useState<Date | null>(new Date());
  const [housingType, setHousingType] = useState<'own' | 'our' | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [coordinatorId, setCoordinatorId] = useState<string | null>(null);

  // users-directory instead of the admin-only /admin/users — recruiters and
  // coordinators can open this modal too, and the admin endpoint 403s for
  // them (leaving the coordinator picker silently empty).
  const { data: users } = useDirectoryUsers();
  const coordinatorOptions = (users?.items ?? [])
    .filter((u) => u.role === 'coordinator' || u.role === 'admin')
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }));

  function submit() {
    if (!workStartDate) {
      notifications.show({ color: 'red', message: t('hire.validationError') });
      return;
    }
    // 2026-07-02 — housing optional (every field independent).
    const payload: HireCandidateInput | RehireCandidateInput = {
      workStartDate: workStartDate.toISOString(),
      housingType: housingType ?? null,
      projectId: projectId ?? null,
      coordinatorId: coordinatorId ?? null,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t(`${mode}.success`) });
        onClose();
        onSuccess?.();
      },
      onError: (err) => {
        const { code, meta } = parseApiError(err);
        notifications.show({
          color: 'red',
          message:
            code === 'VALIDATION' && meta?.reason === 'already_employed'
              ? t('hire.alreadyEmployed')
              : apiErrorMessage(err),
          autoClose: 8000,
        });
      },
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t(`${mode}.title`)} size="md">
      <Stack>
        {/* Date-only per client request 2026-07-04 — the hour carried no
            business meaning and confused users. */}
        <DateInput
          label={t('hire.employedAt')}
          valueFormat="DD.MM.YYYY"
          value={workStartDate}
          onChange={(v) => setWorkStartDate(v ? new Date(v) : null)}
          required
        />
        <Select
          label={t('hire.housing')}
          data={[
            { value: 'own', label: t('housing.own') },
            { value: 'our', label: t('housing.our') },
          ]}
          value={housingType}
          onChange={(v) => setHousingType(v as 'own' | 'our' | null)}
          clearable
        />
        <ProjectSelect
          value={projectId}
          onChange={setProjectId}
          label={t('hire.project')}
        />
        <Select
          label={t('hire.coordinator')}
          data={coordinatorOptions}
          value={coordinatorId}
          onChange={setCoordinatorId}
          clearable
          searchable
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {t(`${mode}.submit`)}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
