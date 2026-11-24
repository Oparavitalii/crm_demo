import { Center, Stack, Title, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function ForbiddenPage() {
  const { t } = useTranslation('errors');
  return (
    <Center mih="100vh">
      <Stack align="center" gap="md">
        <Title order={2}>403</Title>
        <Text c="dimmed">{t('forbidden')}</Text>
        <Button component={Link} to="/" variant="light">
          {t('home', { defaultValue: 'Home' })}
        </Button>
      </Stack>
    </Center>
  );
}
