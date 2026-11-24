import { Alert, Button, Code, Stack } from '@mantine/core';
import type { FallbackProps } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useTranslation(['errors', 'common']);
  const isDev = import.meta.env.DEV;
  const detail = error instanceof Error ? error.message : String(error);

  return (
    <Stack p="xl" maw={720} mx="auto">
      <Alert color="red" title={t('errors:generic')} />
      {isDev && <Code block>{detail}</Code>}
      <Button onClick={resetErrorBoundary} variant="light">
        {t('common:actions.back')}
      </Button>
    </Stack>
  );
}
