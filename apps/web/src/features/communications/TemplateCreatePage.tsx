import { Container, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseApiError } from '@/lib/http';
import { useCreateTemplate } from './api';
import { TemplateForm } from './TemplateForm';

export function TemplateCreatePage() {
  const { t } = useTranslation(['communications', 'errors']);
  const navigate = useNavigate();
  const create = useCreateTemplate();

  return (
    <Container size="md">
      <Title order={2} mb="lg" data-reveal>{t('communications:templates.form.createTitle')}</Title>
      <TemplateForm
        onSubmit={(values) => {
          create.mutate(values, {
            onSuccess: (row) => {
              notifications.show({ color: 'green', message: t('communications:templates.form.created') });
              navigate(`/communications/${row.id}`);
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
        isPending={create.isPending}
        onCancel={() => navigate('/communications')}
      />
    </Container>
  );
}
