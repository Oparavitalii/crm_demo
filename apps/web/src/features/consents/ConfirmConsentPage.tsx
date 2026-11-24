import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { CircleCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  type ConfirmConsentResponse,
  type ConsentChannel,
  type OptinTokenInfoResponse,
} from '@crm/shared';
import { http, parseApiError } from '@/lib/http';

// idle: choosing channels · success: saved · invalid: bad/expired/used token ·
// error: transient network failure. Mirrors WithdrawConsentPage's phases.
type Phase = 'idle' | 'success' | 'invalid' | 'error';

const tokenSchema = z.string().uuid();

export function ConfirmConsentPage() {
  const { t } = useTranslation('auth');
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('idle');
  // Preferences are prefilled from the CURRENT state once the token info loads
  // (see the effect below), so the checkboxes reflect what the person is signed
  // up for right now — not a blanket "checked by default".
  const [email, setEmail] = useState(false);
  const [sms, setSms] = useState(false);
  const [saved, setSaved] = useState<ConsentChannel[]>([]);

  // Token comes from the URL path — validate format before any request. A
  // malformed link is most likely user-pasted garbage; show the same neutral
  // "invalid" state we use for expired/used tokens (no enumeration signal).
  const tokenIsValid = tokenSchema.safeParse(token).success;

  const info = useQuery({
    queryKey: ['optin-info', token],
    enabled: tokenIsValid,
    retry: false,
    queryFn: (): Promise<OptinTokenInfoResponse> =>
      http(`/public/consents/optin/${token}`),
  });

  // Prefill the checkboxes with the candidate's current opt-in state — but only
  // once. A guard ref keeps a later refetch (e.g. window refocus) from stomping
  // on choices the person has since toggled but not yet saved.
  const prefilled = useRef(false);
  useEffect(() => {
    if (info.data && !prefilled.current) {
      prefilled.current = true;
      setEmail(info.data.emailConsent);
      setSms(info.data.smsConsent);
    }
  }, [info.data]);

  const mut = useMutation({
    mutationFn: async (channels: ConsentChannel[]): Promise<ConfirmConsentResponse> =>
      http('/public/consents/confirm', {
        method: 'POST',
        body: { token, channels },
      }),
    onSuccess: (res) => {
      setSaved(res.channels);
      setPhase('success');
    },
    onError: (err) => {
      const { code } = parseApiError(err);
      setPhase(code === 'INVALID_TOKEN' ? 'invalid' : 'error');
    },
  });

  const hasEmail = info.data?.hasEmail ?? false;
  const hasPhone = info.data?.hasPhone ?? false;
  const selected: ConsentChannel[] = [];
  if (hasEmail && email) selected.push('email');
  if (hasPhone && sms) selected.push('sms');

  // A bad token format or a 400 from the info fetch → neutral invalid state.
  const linkBroken = !tokenIsValid || info.isError;
  const showInvalid = phase === 'invalid' || (linkBroken && phase !== 'success');

  return (
    <Container size={520} py={80}>
      <Title order={2} ta="center" mb="lg">
        {t('confirmConsent.title')}
      </Title>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          {phase === 'success' ? (
            <Alert icon={<CircleCheck size={16} />} color="green" variant="light">
              <Text size="sm">{t('confirmConsent.success')}</Text>
              {saved.length > 0 ? (
                <Text size="sm" mt={4}>
                  {t('confirmConsent.successChannels', {
                    channels: saved.map((c) => (c === 'email' ? 'Email' : 'SMS')).join(', '),
                  })}
                </Text>
              ) : (
                <Text size="sm" mt={4}>
                  {t('confirmConsent.successNone')}
                </Text>
              )}
              <Text size="xs" c="dimmed" mt="sm">
                {t('confirmConsent.successOptOut')}
              </Text>
            </Alert>
          ) : showInvalid ? (
            <Alert icon={<ShieldX size={16} />} color="orange" variant="light">
              {t('confirmConsent.invalidOrUsed')}
            </Alert>
          ) : phase === 'error' ? (
            <Alert icon={<TriangleAlert size={16} />} color="red" variant="light">
              {t('confirmConsent.networkError')}
            </Alert>
          ) : info.isPending ? (
            <Stack align="center" py="md">
              <Loader size="sm" />
            </Stack>
          ) : (
            <>
              <Text size="sm">{t('confirmConsent.intro')}</Text>
              {hasEmail && (
                <Checkbox
                  label={t('confirmConsent.emailChannel')}
                  checked={email}
                  onChange={(e) => setEmail(e.currentTarget.checked)}
                />
              )}
              {hasPhone && (
                <Checkbox
                  label={t('confirmConsent.smsChannel')}
                  checked={sms}
                  onChange={(e) => setSms(e.currentTarget.checked)}
                />
              )}
              {selected.length === 0 && (
                <Text size="xs" c="dimmed">
                  {t('confirmConsent.allOffNote')}
                </Text>
              )}
              {/* Always enabled — an empty selection is a valid choice (opt out
                  of everything). This is a preference center, not a one-way
                  opt-in gate. */}
              <Button fullWidth loading={mut.isPending} onClick={() => mut.mutate(selected)}>
                {t('confirmConsent.save')}
              </Button>
              <Text size="xs" c="dimmed">
                {t('confirmConsent.changeAnytime')}
              </Text>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
