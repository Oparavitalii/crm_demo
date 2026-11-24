import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Code,
  Container,
  CopyButton,
  Group,
  Image,
  Modal,
  PinInput,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Copy, KeyRound } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { modals } from '@mantine/modals';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import { useAuthStore } from '@/lib/auth-store';
import { useEnroll2FA, useConfirm2FA, useDisable2FA } from '@/features/auth/api';
import { useMyAcceptances } from '@/features/documents/api';
import { apiFetch, parseApiError } from '@/lib/http';

type EnrollStep = 'idle' | 'qr' | 'confirm';

export function ProfilePage() {
  const { t } = useTranslation('auth');
  const user = useAuthStore((s) => s.user);

  const enroll = useEnroll2FA();
  const confirm = useConfirm2FA();
  const disable = useDisable2FA();

  // Enrollment modal state
  const [enrollStep, setEnrollStep] = useState<EnrollStep>('idle');
  const [enrollData, setEnrollData] = useState<{
    secret: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [enrollCode, setEnrollCode] = useState('');

  // Disable modal state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const resetPassword = useMutation({
    mutationFn: () =>
      apiFetch<{ emailSent: boolean }>('/me/reset-password', { method: 'POST' }),
    meta: { errorHandled: true },
  });

  function handleResetSelf() {
    modals.openConfirmModal({
      title: t('resetSelf.title'),
      children: <Text size="sm">{t('resetSelf.confirm')}</Text>,
      labels: { confirm: t('resetSelf.button'), cancel: t('twoFactor.cancel', { defaultValue: 'Anuluj' }) },
      onConfirm: () => {
        resetPassword.mutate(undefined, {
          onSuccess: (res) => {
            notifications.show({
              color: res.emailSent ? 'green' : 'yellow',
              message: res.emailSent ? t('resetSelf.success') : t('resetSelf.emailFailed'),
            });
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message: code === 'TOO_MANY_REQUESTS' ? t('resetSelf.tooMany') : t('resetSelf.error'),
            });
          },
        });
      },
    });
  }

  if (!user) return null;

  const is2FAEnabled = user.has2FA;
  const isAdmin = user.role === 'admin';

  function handleEnrollStart() {
    enroll.mutate(undefined, {
      onSuccess: (data) => {
        setEnrollData({ secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl });
        setEnrollStep('qr');
      },
      onError: () => {
        notifications.show({ color: 'red', message: 'Failed to start 2FA enrollment' });
      },
    });
  }

  function handleEnrollConfirm() {
    if (!enrollData) return;
    confirm.mutate(
      { secret: enrollData.secret, code: enrollCode },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('twoFactor.enabled') });
          setEnrollStep('idle');
          setEnrollData(null);
          setEnrollCode('');
          // Refresh user in store — mark has2FA = true
          useAuthStore.setState((s) => ({
            user: s.user ? { ...s.user, has2FA: true } : null,
          }));
        },
        onError: () => {
          setEnrollCode('');
          notifications.show({ color: 'red', message: t('twoFactor.invalidCode') });
        },
      },
    );
  }

  function handleDisable() {
    disable.mutate(
      { password: disablePassword, code: disableCode },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('twoFactor.disabled') });
          setDisableOpen(false);
          setDisablePassword('');
          setDisableCode('');
          useAuthStore.setState((s) => ({
            user: s.user ? { ...s.user, has2FA: false } : null,
          }));
        },
        onError: () => {
          setDisableCode('');
          notifications.show({ color: 'red', message: t('twoFactor.invalidCode') });
        },
      },
    );
  }

  return (
    <Container size="sm" py="xl">
      <Title order={2} mb="lg" data-reveal>
        {user.firstName} {user.lastName}
      </Title>

      <Card withBorder mb="md">
        <Stack gap="xs">
          <Text fw={600}>Email: <Text component="span" fw={400}>{user.email}</Text></Text>
          <Text fw={600}>Role: <Text component="span" fw={400}>{user.role}</Text></Text>
        </Stack>
      </Card>

      {user.publicSlug && user.isActive && (
        <Card withBorder mb="md">
          <Stack gap="xs">
            <Title order={5}>{t('applyLink.title')}</Title>
            <Text size="xs" c="dimmed">{t('applyLink.hint')}</Text>
            <Group align="flex-end" gap="sm">
              <TextInput
                value={`${window.location.origin}/apply/${user.publicSlug}`}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                miw={200}
                style={{ flex: 1 }}
              />
              <CopyButton value={`${window.location.origin}/apply/${user.publicSlug}`}>
                {({ copied, copy }) => (
                  <Button variant="light" leftSection={<Copy size={16} />} onClick={copy}>
                    {copied ? t('applyLink.copy') + ' ✓' : t('applyLink.copy')}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder mb="md">
        <Stack gap="xs">
          <Group gap="xs">
            <KeyRound size={16} />
            <Title order={5}>{t('resetSelf.title')}</Title>
          </Group>
          <Text size="xs" c="dimmed">{t('resetSelf.hint')}</Text>
          <Group>
            <Button
              variant="light"
              leftSection={<KeyRound size={16} />}
              loading={resetPassword.isPending}
              onClick={handleResetSelf}
            >
              {t('resetSelf.button')}
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">{t('twoFactor.title')}</Title>

        {!isAdmin ? (
          <Text c="dimmed">{t('twoFactor.adminOnly')}</Text>
        ) : (
          <Stack>
            <Group>
              <Text fw={500}>Status:</Text>
              {is2FAEnabled ? (
                <Badge color="green">{t('twoFactor.enabled')}</Badge>
              ) : (
                <Badge color="gray">{t('twoFactor.disabled')}</Badge>
              )}
            </Group>

            {is2FAEnabled ? (
              <Button color="red" variant="outline" onClick={() => setDisableOpen(true)}>
                {t('twoFactor.disable')}
              </Button>
            ) : (
              <Button onClick={handleEnrollStart} loading={enroll.isPending}>
                {t('twoFactor.enrollPrompt')}
              </Button>
            )}
          </Stack>
        )}
      </Card>

      {/* Enrollment modal — QR step */}
      <Modal
        opened={enrollStep === 'qr' && enrollData !== null}
        onClose={() => { setEnrollStep('idle'); setEnrollData(null); setEnrollCode(''); }}
        title={t('twoFactor.scanQrCode')}
      >
        <Stack>
          {enrollData && (
            <>
              <Image src={enrollData.qrCodeDataUrl} alt="QR code" mx="auto" w={200} h={200} />
              <Text size="sm" c="dimmed" ta="center">{t('twoFactor.scanQrCode')}</Text>
              <Code block>{enrollData.secret}</Code>
              <Text size="sm">{t('twoFactor.enterCode')}</Text>
              <PinInput
                length={6}
                type="number"
                value={enrollCode}
                onChange={setEnrollCode}
                mx="auto"
                disabled={confirm.isPending}
              />
              <Button
                fullWidth
                loading={confirm.isPending}
                disabled={enrollCode.length !== 6}
                onClick={handleEnrollConfirm}
              >
                {t('twoFactor.confirm')}
              </Button>
            </>
          )}
        </Stack>
      </Modal>

      {/* Disable 2FA modal */}
      <Modal
        opened={disableOpen}
        onClose={() => { setDisableOpen(false); setDisablePassword(''); setDisableCode(''); }}
        title={t('twoFactor.disable')}
      >
        <Stack>
          <PasswordInput
            label="Password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.currentTarget.value)}
          />
          <Text size="sm">{t('twoFactor.enterCode')}</Text>
          <PinInput
            length={6}
            type="number"
            value={disableCode}
            onChange={setDisableCode}
            mx="auto"
            disabled={disable.isPending}
          />
          <Button
            color="red"
            fullWidth
            loading={disable.isPending}
            disabled={disableCode.length !== 6 || !disablePassword}
            onClick={handleDisable}
          >
            {t('twoFactor.disable')}
          </Button>
        </Stack>
      </Modal>

      <MyAcceptancesSection />
    </Container>
  );
}

function MyAcceptancesSection() {
  const { t } = useTranslation(['documents', 'admin']);
  const { data: mine } = useMyAcceptances();
  const items = mine?.items ?? [];
  return (
    <Stack gap="xs" mt="xl">
      <Title order={4}>{t('documents:profile.myAcceptances')}</Title>
      {items.length === 0 ? (
        <Text c="dimmed" size="sm">—</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Dokument</Table.Th>
              <Table.Th>Wersja</Table.Th>
              <Table.Th>Data</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.documentTitle}</Table.Td>
                <Table.Td>v{a.version}</Table.Td>
                <Table.Td>{new Date(a.acceptedAt).toLocaleString('pl-PL')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
