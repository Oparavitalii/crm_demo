import { Badge, Button, Container, Divider, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { MessageTemplate } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { parseApiError } from '@/lib/http';
import { useTemplate, useDeleteTemplate } from './api';
import { CHANNEL_COLORS } from './columns';

function TemplateDetailInner({ template: tmpl }: { template: MessageTemplate }) {
  const { t } = useTranslation(['communications', 'errors']);
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === 'admin' || role === 'recruiter';
  const del = useDeleteTemplate();

  function handleDelete() {
    modals.openConfirmModal({
      title: t('communications:templates.detail.delete'),
      children: <Text>{t('communications:templates.detail.deleteConfirm')}</Text>,
      labels: { confirm: t('communications:templates.detail.delete'), cancel: t('communications:templates.form.cancel') },
      confirmProps: { color: 'red', loading: del.isPending },
      onConfirm: () => {
        del.mutate(tmpl.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('communications:templates.detail.deleted') });
            navigate('/communications');
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message: code === 'FORBIDDEN'
                ? t('communications:templates.errors.noPermission')
                : t('errors:generic'),
            });
          },
        });
      },
    });
  }

  return (
    <Container size="md">
      <Group justify="space-between" mb="md">
        <Group>
          <Button variant="subtle" leftSection={<ArrowLeft size={16} />} onClick={() => navigate('/communications')}>
            {t('communications:templates.detail.back')}
          </Button>
          <Title order={2} data-reveal>{tmpl.name}</Title>
          <Badge color={CHANNEL_COLORS[tmpl.channel]} variant="light">
            {t(`communications:templates.channel.${tmpl.channel}`)}
          </Badge>
          {tmpl.autoSendOnCreate && (
            <Badge color="grape" variant="light">
              {t('communications:templates.badge.onboarding')}
            </Badge>
          )}
        </Group>
        {canManage && (
          <Group>
            <Button leftSection={<Edit size={16} />} onClick={() => navigate(`/communications/${tmpl.id}/edit`)}>
              {t('communications:templates.detail.edit')}
            </Button>
            <Button color="red" variant="light" leftSection={<Trash2 size={16} />} onClick={handleDelete}>
              {t('communications:templates.detail.delete')}
            </Button>
          </Group>
        )}
      </Group>

      <Paper withBorder shadow="sm" p="lg" radius="md" mb="md" data-reveal>
        <Stack>
          {tmpl.subject && (
            <>
              <Group justify="space-between">
                <Text c="dimmed" size="sm">{t('communications:templates.fields.subject')}</Text>
                <Text>{tmpl.subject}</Text>
              </Group>
              <Divider />
            </>
          )}
          <Text c="dimmed" size="sm">{t('communications:templates.fields.body')}</Text>
          <div
            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: 12 }}
          >
            <div dangerouslySetInnerHTML={{ __html: tmpl.body }} />
          </div>
          {tmpl.variables.length > 0 && (
            <>
              <Divider />
              <Text c="dimmed" size="sm">{t('communications:templates.fields.variables')}</Text>
              <Text>{tmpl.variables.map((v) => `{{${v}}}`).join(', ')}</Text>
            </>
          )}
          <Divider />
          <Group justify="space-between">
            <Text c="dimmed" size="sm">{t('communications:templates.fields.createdAt')}</Text>
            <Text>{new Date(tmpl.createdAt).toLocaleString()}</Text>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}

export function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isPending } = useTemplate(id);

  if (isPending || !template) return <Splash />;
  return <TemplateDetailInner template={template} />;
}
