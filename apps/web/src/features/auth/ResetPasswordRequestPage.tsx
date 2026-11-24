import { Button, Container, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resetRequestSchema, type ResetRequestInput } from '@crm/shared';
import { useRequestReset } from './api';

export function ResetPasswordRequestPage() {
  const { t } = useTranslation('auth');
  const [sent, setSent] = useState(false);
  const request = useRequestReset();
  const form = useForm<ResetRequestInput>({
    initialValues: { email: '' },
    validate: zodResolver(resetRequestSchema),
  });

  return (
    <Container size={420} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('reset.requestTitle')}
      </Title>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        {sent ? (
          <Text>{t('reset.requestSuccess')}</Text>
        ) : (
          <form
            onSubmit={form.onSubmit((values) =>
              request.mutate(values, {
                onSuccess: () => setSent(true),
                onError: () => {
                  // Backend always returns 200; only network failure reaches here
                  notifications.show({ color: 'red', message: t('login.networkError') });
                },
              }),
            )}
          >
            <Stack>
              <Text c="dimmed" size="sm">{t('reset.requestPrompt')}</Text>
              <TextInput label={t('login.email')} {...form.getInputProps('email')} required />
              <Button type="submit" loading={request.isPending} fullWidth>
                {t('reset.requestSubmit')}
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
    </Container>
  );
}
