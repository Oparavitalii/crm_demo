import { Button, Container, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { resetConfirmSchema, type ResetConfirmInput } from '@crm/shared';
import { useConfirmReset } from './api';

const formSchema = resetConfirmSchema
  .extend({ confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'passwordsDontMatch' });

export function ResetPasswordConfirmPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const confirm = useConfirmReset();

  const form = useForm<ResetConfirmInput & { confirmPassword: string }>({
    initialValues: { token, newPassword: '', confirmPassword: '' },
    validate: zodResolver(formSchema),
  });

  return (
    <Container size={420} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('reset.confirmTitle')}
      </Title>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        {!token ? (
          <Text c="red">{t('reset.missingToken')}</Text>
        ) : (
          <form
            onSubmit={form.onSubmit((values) =>
              confirm.mutate(
                { token: values.token, newPassword: values.newPassword },
                {
                  onSuccess: () => {
                    notifications.show({ color: 'green', message: t('reset.confirmSuccess') });
                    navigate('/login', { replace: true });
                  },
                  onError: (err: unknown) => {
                    const status = (err as { response?: { status?: number } }).response?.status;
                    notifications.show({
                      color: 'red',
                      message: status === 400 ? t('reset.invalidToken') : t('login.networkError'),
                    });
                  },
                },
              ),
            )}
          >
            <Stack>
              <PasswordInput label={t('reset.newPassword')} {...form.getInputProps('newPassword')} required />
              <PasswordInput label={t('reset.confirmPassword')} {...form.getInputProps('confirmPassword')} required />
              <Button type="submit" loading={confirm.isPending} fullWidth>
                {t('reset.confirmSubmit')}
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
    </Container>
  );
}
