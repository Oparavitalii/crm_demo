import { Container, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { MessageTemplate } from '@crm/shared';
import { Splash } from '@/components/Splash';
import { parseApiError } from '@/lib/http';
import { useTemplate, useUpdateTemplate } from './api';
import { TemplateForm } from './TemplateForm';

function TemplateEditInner({ template: tmpl }: { template: MessageTemplate }) {
  const { t } = useTranslation(['communications', 'errors']);
  const navigate = useNavigate();
  const update = useUpdateTemplate(tmpl.id);

  return (
    <Container size="md">
      <Title order={2} mb="lg" data-reveal>{t('communications:templates.form.editTitle')}</Title>
      <TemplateForm
        initial={tmpl}
        onSubmit={(values) => {
          update.mutate(values, {
            onSuccess: () => {
              notifications.show({ color: 'green', message: t('communications:templates.form.saved') });
              navigate(`/communications/${tmpl.id}`);
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
        }}
        isPending={update.isPending}
        onCancel={() => navigate(`/communications/${tmpl.id}`)}
        isEdit
      />
    </Container>
  );
}

export function TemplateEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isPending } = useTemplate(id);

  if (isPending || !template) return <Splash />;
  return <TemplateEditInner template={template} />;
}
