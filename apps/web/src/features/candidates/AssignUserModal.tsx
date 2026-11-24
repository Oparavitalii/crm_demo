import { useState } from 'react';
import { Button, Group, Modal, Select, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useAdminUsers } from '@/features/admin-users/api';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useUpdateCandidate } from './api';

interface Props {
  opened: boolean;
  onClose: () => void;
  candidateId: string;
  field: 'recruiter' | 'coordinator';
}

// Lightweight modal opened from the empty-cell "+ Призначити" buttons on the
// /clients list. Sets recruiterId or coordinatorId on the candidate. Roles
// allowed differ — recruiter+admin for recruiter slot, coordinator+admin for
// coordinator slot.
export function AssignUserModal({ opened, onClose, candidateId, field }: Props) {
  const { t } = useTranslation(['candidates', 'errors']);
  const apiErrorMessage = useApiErrorMessage();
  const update = useUpdateCandidate(candidateId);
  const [userId, setUserId] = useState<string | null>(null);

  const { data } = useAdminUsers({ pageSize: 100 });
  const eligible = (data?.items ?? []).filter((u) => {
    if (field === 'recruiter') return u.role === 'recruiter' || u.role === 'admin';
    return u.role === 'coordinator' || u.role === 'admin';
  });
  const options = eligible.map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName}`.trim(),
  }));

  function submit() {
    if (!userId) return;
    const patch = field === 'recruiter' ? { recruiterId: userId } : { coordinatorId: userId };
    update.mutate(patch, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t('list.assignSuccess', { defaultValue: 'Призначено' }) });
        onClose();
        setUserId(null);
      },
      onError: (err: unknown) => {
        notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
      },
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        field === 'recruiter'
          ? t('list.assignRecruiter', { defaultValue: 'Призначити рекрутера' })
          : t('list.assignCoordinator', { defaultValue: 'Призначити координатора' })
      }
      size="sm"
    >
      <Stack>
        <Select
          data={options}
          value={userId}
          onChange={setUserId}
          searchable
          required
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button onClick={submit} disabled={!userId} loading={update.isPending}>
            {t('list.assignSubmit', { defaultValue: 'Призначити' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
