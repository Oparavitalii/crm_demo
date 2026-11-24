import { Button, Container, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { acceptInvitationSchema } from '@crm/shared';
import { useAcceptInvitation } from './api';

const formSchema = acceptInvitationSchema
  .extend({ confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordsDontMatch',
  });

type FormValues = z.infer<typeof formSchema>;

export function RegisterPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const acceptInvitation = useAcceptInvitation();

  const form = useForm<FormValues>({
    initialValues: { token, password: '', confirmPassword: '' },
    validate: zodResolver(formSchema),
  });

  return (
    <Container size={420} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('register.title')}
      </Title>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        {!token ? (
          <Text c="red">{t('register.missingToken')}</Text>
        ) : (
          <>
            <Text size="sm" c="dimmed" mb="md">
              {t('register.prompt')}
            </Text>
            <form
              onSubmit={form.onSubmit((values) =>
                acceptInvitation.mutate(
                  { token: values.token, password: values.password },
                  {
                    onSuccess: () => {
                      notifications.show({ color: 'green', message: t('register.success') });
                      navigate('/login', { replace: true });
                    },
                    onError: (err: unknown) => {
                      const status = (err as { response?: { status?: number } }).response?.status;
                      // 409 = the account is already active (e.g. the invitee
                      // already registered via another email). Don't mislabel it
                      // as an invalid link — point them at login instead.
                      if (status === 409) {
                        notifications.show({ color: 'yellow', message: t('register.alreadyActive') });
                        navigate('/login', { replace: true });
                        return;
                      }
                      const message =
                        status === 400 ? t('register.invalidToken') : t('login.networkError');
                      notifications.show({ color: 'red', message });
                    },
                  },
                ),
              )}
            >
              <Stack>
                <PasswordInput
                  label={t('register.password')}
                  autoComplete="new-password"
                  {...form.getInputProps('password')}
                  required
                />
                <PasswordInput
                  label={t('register.confirmPassword')}
                  autoComplete="new-password"
                  {...form.getInputProps('confirmPassword')}
                  required
                />
                <Button type="submit" loading={acceptInvitation.isPending} fullWidth>
                  {t('register.submit')}
                </Button>
              </Stack>
            </form>
          </>
        )}
      </Paper>
    </Container>
  );
}
