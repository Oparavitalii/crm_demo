import {
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  EMPLOYER_INQUIRY_STATUSES,
  type EmployerInquiry,
  type EmployerInquiryStatus,
} from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { useDeleteEmployerInquiry, useEmployerInquiry, useUpdateEmployerInquiry } from './api';

const STATUS_COLORS: Record<EmployerInquiryStatus, string> = {
  new: 'blue',
  contacted: 'cyan',
  accepted: 'green',
  rejected: 'red',
  archived: 'gray',
};

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Text c="dimmed" size="sm">{label}</Text>
      <Text style={{ textAlign: 'right', maxWidth: '60%' }}>{value ?? '—'}</Text>
    </Group>
  );
}

function Inner({ inquiry }: { inquiry: EmployerInquiry }) {
  const { t } = useTranslation('employers');
  const apiErrorMessage = useApiErrorMessage();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);

  const [status, setStatus] = useState<EmployerInquiryStatus>(inquiry.status);
  const [internalNotes, setInternalNotes] = useState(inquiry.internalNotes ?? '');

  const update = useUpdateEmployerInquiry(inquiry.id);
  const del = useDeleteEmployerInquiry();

  const canEdit = role === 'admin' || role === 'coordinator' || role === 'recruiter';
  const canDelete = role === 'admin';

  function handleSave() {
    update.mutate(
      { status, internalNotes: internalNotes || null },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('detail.saved') });
        },
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  function handleDelete() {
    modals.openConfirmModal({
      title: t('detail.delete'),
      children: <Text>{t('detail.deleteConfirm')}</Text>,
      labels: { confirm: t('detail.delete'), cancel: t('form.cancel') },
      confirmProps: { color: 'red', loading: del.isPending },
      onConfirm: () => {
        del.mutate(inquiry.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('detail.deleted') });
            navigate('/employer-inquiries');
          },
          onError: (err: unknown) => {
            notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
          },
        });
      },
    });
  }

  return (
    <Container size="md">
      <Group justify="space-between" mb="md">
        <Group>
          <Button
            variant="subtle"
            leftSection={<ArrowLeft size={16} />}
            onClick={() => navigate('/employer-inquiries')}
          >
            {t('detail.back')}
          </Button>
          <Title order={2} data-reveal>{inquiry.companyName}</Title>
          <Badge color={STATUS_COLORS[inquiry.status]} variant="light">
            {t(`status.${inquiry.status}`)}
          </Badge>
        </Group>
        {canDelete && (
          <Button
            color="red"
            variant="light"
            leftSection={<Trash2 size={16} />}
            onClick={handleDelete}
          >
            {t('detail.delete')}
          </Button>
        )}
      </Group>

      <Paper withBorder shadow="sm" p="lg" radius="md" mb="lg" data-reveal>
        <Stack>
          <FieldRow label={t('fields.contactPerson')} value={inquiry.contactPerson} />
          <FieldRow
            label={t('fields.email')}
            value={<a href={`mailto:${inquiry.email}`}>{inquiry.email}</a>}
          />
          <FieldRow
            label={t('fields.phone')}
            value={<a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a>}
          />
          <FieldRow label={t('fields.source')} value={t(`source.${inquiry.source}`)} />
          <FieldRow
            label={t('fields.createdAt')}
            value={new Date(inquiry.createdAt).toLocaleString()}
          />
          {inquiry.contactedAt && (
            <FieldRow
              label={t('fields.contactedAt')}
              value={new Date(inquiry.contactedAt).toLocaleString()}
            />
          )}
          {inquiry.closedAt && (
            <FieldRow
              label={t('fields.closedAt')}
              value={new Date(inquiry.closedAt).toLocaleString()}
            />
          )}
          <Divider />
          <Text c="dimmed" size="sm">{t('fields.message')}</Text>
          <Paper p="sm" bg="var(--mantine-color-gray-0)" radius="sm">
            <Text style={{ whiteSpace: 'pre-wrap' }}>{inquiry.message}</Text>
          </Paper>
        </Stack>
      </Paper>

      {canEdit && (
        <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
          <Stack>
            <Title order={4}>{t('detail.manage')}</Title>
            <Select
              label={t('fields.status')}
              data={EMPLOYER_INQUIRY_STATUSES.map((s) => ({
                value: s,
                label: t(`status.${s}`),
              }))}
              value={status}
              onChange={(v) => v && setStatus(v as EmployerInquiryStatus)}
              allowDeselect={false}
            />
            <Textarea
              label={t('fields.internalNotes')}
              placeholder={t('detail.notesPlaceholder')}
              minRows={3}
              autosize
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button onClick={handleSave} loading={update.isPending}>
                {t('detail.save')}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Container>
  );
}

export function EmployerInquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: inquiry, isPending } = useEmployerInquiry(id);

  if (isPending || !inquiry) return <Splash />;
  return <Inner inquiry={inquiry} />;
}
