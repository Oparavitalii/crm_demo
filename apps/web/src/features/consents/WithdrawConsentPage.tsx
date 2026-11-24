import { useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { CircleCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  withdrawConsentSchema,
  type WithdrawConsentResponse,
} from '@crm/shared';
import { http, parseApiError } from '@/lib/http';

type Phase = 'idle' | 'success' | 'invalid' | 'error';

export function WithdrawConsentPage() {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('idle');

  // Token comes from the URL path — validate format before the user clicks.
  // A malformed link is most likely user-pasted garbage; show the same neutral
  // "invalid" state we use for already-withdrawn tokens (no enumeration signal).
  const tokenValidation = withdrawConsentSchema.safeParse({ token });
  const tokenIsValid = tokenValidation.success;

  const mut = useMutation({
    mutationFn: async (): Promise<WithdrawConsentResponse> => {
      return http('/public/consents/withdraw', {
        method: 'POST',
        body: { token },
      });
    },
    onSuccess: () => setPhase('success'),
    onError: (err) => {
      const { code } = parseApiError(err);
      setPhase(code === 'INVALID_TOKEN' ? 'invalid' : 'error');
    },
  });

  return (
    <Container size={520} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('withdraw.title')}
      </Title>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          {phase === 'idle' && (
            <>
              <Text size="sm">{t('withdraw.intro')}</Text>
              <Text size="sm" c="dimmed">
                {t('withdraw.consequence')}
              </Text>
              {!tokenIsValid && (
                <Alert
                  icon={<TriangleAlert size={16} />}
                  color="orange"
                  variant="light"
                >
                  {t('withdraw.invalidLink')}
                </Alert>
              )}
              <Button
                color="red"
                fullWidth
                disabled={!tokenIsValid}
                loading={mut.isPending}
                onClick={() => mut.mutate()}
              >
                {t('withdraw.confirm')}
              </Button>
            </>
          )}
          {phase === 'success' && (
            <Alert icon={<CircleCheck size={16} />} color="green" variant="light">
              {t('withdraw.success')}
            </Alert>
          )}
          {phase === 'invalid' && (
            <Alert icon={<ShieldX size={16} />} color="orange" variant="light">
              {t('withdraw.invalidOrUsed')}
            </Alert>
          )}
          {phase === 'error' && (
            <Alert icon={<TriangleAlert size={16} />} color="red" variant="light">
              {t('withdraw.networkError')}
            </Alert>
          )}
          <Anchor component={Link} to="/login" size="sm" ta="center">
            {t('withdraw.backToLogin')}
          </Anchor>
        </Stack>
      </Paper>
    </Container>
  );
}
