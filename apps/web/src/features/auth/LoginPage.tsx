import { useEffect, useState } from 'react';
import { Alert, Anchor, Button, Container, Paper, PinInput, Stack, Text, TextInput, Title, PasswordInput } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@opushr/shared';
import { useLogin, useVerify2FA } from './api';
import { useAuthStore } from '@/lib/auth-store';

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL;
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD;

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const login = useLogin();
  const verify2FA = useVerify2FA();
  const [partialToken, setPartialToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');

  // Warm up Neon while the user is typing credentials. The login page is the
  // common entry point after overnight idle, when Neon scale-to-zero has put
  // compute to sleep. /health/ready hits the DB (SELECT 1), giving it a
  // ~15s head-start so the first authenticated query after submit doesn't
  // wait on a cold pool. /health (liveness) wouldn't wake Neon — that's the
  // whole point of having two endpoints.
  useEffect(() => {
    const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
    fetch(`${baseURL}/health/ready`, { keepalive: true }).catch(() => {});
  }, []);

  const form = useForm<LoginInput>({
    // Public demo build: VITE_DEMO_EMAIL / VITE_DEMO_PASSWORD pre-fill the
    // shared guest login. Unset in a normal build, so the form starts empty.
    initialValues: { email: DEMO_EMAIL ?? '', password: DEMO_PASSWORD ?? '' },
    validate: zodResolver(loginSchema),
  });

  if (user) return <Navigate to="/" replace />;

  // Step 2 — TOTP verification
  if (partialToken !== null) {
    return (
      <Container size={420} py={80}>
        <Title order={2} ta="center" mb="lg">
          {t('twoFactor.title')}
        </Title>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            <Text size="sm" c="dimmed" ta="center">
              {t('twoFactor.enterCode')}
            </Text>
            <PinInput
              length={6}
              type="number"
              value={otpCode}
              onChange={setOtpCode}
              mx="auto"
              disabled={verify2FA.isPending}
            />
            <Button
              fullWidth
              loading={verify2FA.isPending}
              disabled={otpCode.length !== 6}
              onClick={() => {
                verify2FA.mutate(
                  { partialToken, code: otpCode },
                  {
                    onSuccess: () => navigate('/', { replace: true }),
                    onError: () => {
                      setOtpCode('');
                      notifications.show({
                        color: 'red',
                        title: t('twoFactor.title'),
                        message: t('twoFactor.invalidCode'),
                      });
                    },
                  },
                );
              }}
            >
              {t('twoFactor.confirm')}
            </Button>
            <Anchor
              size="sm"
              ta="center"
              onClick={() => {
                setPartialToken(null);
                setOtpCode('');
              }}
            >
              {t('login.forgotPassword')}
            </Anchor>
          </Stack>
        </Paper>
      </Container>
    );
  }

  // Step 1 — email + password
  return (
    <Container size={420} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('login.title')}
      </Title>
      {DEMO_EMAIL && (
        <Alert color="blue" mb="md" title={t('login.demoTitle', { defaultValue: 'Public demo' })}>
          {t('login.demoNotice', {
            defaultValue:
              'All people and companies are fictional. Data is reset every night. The demo login is pre-filled — just press Sign in.',
          })}
        </Alert>
      )}
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form
          onSubmit={form.onSubmit((values) => {
            login.mutate(values, {
              onSuccess: (data) => {
                if (data.requires2FA && data.partialToken) {
                  setPartialToken(data.partialToken);
                } else if (data.accessToken) {
                  useAuthStore.getState().setSession(data.user, data.accessToken);
                  navigate('/', { replace: true });
                }
              },
              onError: (err: unknown) => {
                const status = (err as { response?: { status?: number } }).response?.status;
                const key =
                  status === 429
                    ? 'login.tooManyAttempts'
                    : status === 401
                      ? 'login.invalidCredentials'
                      : 'login.networkError';
                notifications.show({ color: 'red', title: t('login.title'), message: t(key) });
              },
            });
          })}
        >
          <Stack>
            <TextInput
              label={t('login.email')}
              autoComplete="email"
              {...form.getInputProps('email')}
              required
            />
            <PasswordInput
              label={t('login.password')}
              autoComplete="current-password"
              {...form.getInputProps('password')}
              required
            />
            <Button type="submit" loading={login.isPending} fullWidth>
              {t('login.submit')}
            </Button>
            <Anchor component={Link} to="/reset-password" size="sm" ta="center">
              {t('login.forgotPassword')}
            </Anchor>
            <Anchor component={Link} to="/privacy" size="xs" ta="center" c="dimmed">
              {t('login.privacy')}
            </Anchor>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
