import { useState } from 'react';
import {
  Alert,
  Button,
  Container,
  CopyButton,
  Group,
  Paper,
  Stack,
  Switch,
  Title,
} from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { AlertTriangle, Copy, Key, LogOut, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Select, TextInput, Text } from '@mantine/core';
import type { AdminUser, UserRole } from '@opushr/shared';
import { updateUserSchema, type UpdateUserInput } from '@opushr/shared';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { parseApiError } from '@/lib/http';
import {
  useAdminUser,
  useUpdateAdminUser,
  useResetAdminUserPassword,
  useForceLogoutAdminUser,
  useResendInvite,
} from './api';

const ROLE_OPTIONS: UserRole[] = ['admin', 'recruiter', 'coordinator', 'readonly'];

function UserEditInner({ user: u }: { user: AdminUser }) {
  const { t } = useTranslation(['admin', 'errors']);
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isSelf = currentUserId === u.id;

  const update = useUpdateAdminUser(u.id);
  const resetPassword = useResetAdminUserPassword();
  const forceLogout = useForceLogoutAdminUser();
  const resendInvite = useResendInvite();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // Email is editable only for unregistered users. Once they've logged in
  // it becomes the login key and any rewrite would lock them out / orphan
  // password-reset links sent to the old address. Service enforces the
  // same check, this is the client-side mirror so the field disables
  // cleanly and the admin gets a tooltip explaining why.
  const emailEditable = u.lastLoginAt === null;

  const form = useForm<UpdateUserInput>({
    initialValues: {
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      isActive: u.isActive,
      isFreelancer: u.isFreelancer,
    },
    validate: zodResolver(updateUserSchema),
  });

  function handleSubmit(values: UpdateUserInput) {
    if (isSelf && values.role !== u.role) {
      notifications.show({ color: 'orange', message: t('users.form.cantEditSelfRole') });
      return;
    }
    if (isSelf && values.isActive === false) {
      notifications.show({ color: 'orange', message: t('users.form.cantDeactivateSelf') });
      return;
    }

    // Strip email if it hasn't changed — keeps the audit diff tidy.
    const payload: UpdateUserInput = { ...values };
    if (payload.email && payload.email.trim().toLowerCase() === u.email.toLowerCase()) {
      delete payload.email;
    }

    update.mutate(payload, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t('users.form.submitSave') });
        navigate(`/admin/users/${u.id}`);
      },
      onError: (err: unknown) => {
        const { code } = parseApiError(err);
        const msg =
          code === 'FORBIDDEN'
            ? t('users.errors.selfProtection')
            : code === 'DUPLICATE'
              ? t('users.errors.emailTaken', { defaultValue: 'Цей email вже використовується' })
              : code === 'NOT_FOUND'
                ? t('users.errors.notFound')
                : t('users.errors.generic');
        notifications.show({ color: 'red', message: msg });
      },
    });
  }

  function handleResetPassword() {
    modals.openConfirmModal({
      title: t('users.detail.resetPassword'),
      children: <Text size="sm">{t('users.detail.resetConfirm')}</Text>,
      labels: {
        confirm: t('users.detail.resetPassword'),
        cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }),
      },
      onConfirm: () => {
        resetPassword.mutate(u.id, {
          onSuccess: (res) => {
            notifications.show({
              color: res.emailSent ? 'green' : 'yellow',
              message: res.emailSent
                ? t('users.form.passwordEmailSent')
                : t('users.form.passwordEmailFailed'),
            });
          },
          onError: () => {
            notifications.show({ color: 'red', message: t('users.errors.generic') });
          },
        });
      },
    });
  }

  function handleResendInvite() {
    resendInvite.mutate(u.id, {
      onSuccess: (res) => {
        if (res.emailSent) {
          setInviteUrl(null);
          notifications.show({
            color: 'green',
            message: t('users.edit.resendSuccess', { email: res.email }),
          });
        } else {
          setInviteUrl(res.inviteUrl);
          notifications.show({
            color: 'yellow',
            message: t('users.edit.resendSuccessNoEmail'),
          });
        }
      },
      onError: (err: unknown) => {
        const { code } = parseApiError(err);
        const msg =
          code === 'ALREADY_ACTIVE'
            ? t('users.edit.alreadyActive')
            : code === 'NOT_FOUND'
              ? t('users.errors.notFound')
              : t('users.edit.resendError');
        notifications.show({ color: 'red', message: msg });
      },
    });
  }

  function handleForceLogout() {
    modals.openConfirmModal({
      title: t('users.detail.forceLogout'),
      children: <Text size="sm">{t('users.detail.forceLogoutConfirm')}</Text>,
      labels: {
        confirm: t('users.detail.forceLogout'),
        cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        forceLogout.mutate(u.id, {
          onSuccess: (res) => {
            notifications.show({
              color: 'green',
              message: `${t('users.detail.forceLogout')}: ${res.sessionsDeleted}`,
            });
          },
          onError: () => {
            notifications.show({ color: 'red', message: t('users.errors.generic') });
          },
        });
      },
    });
  }

  return (
    <Container size="md">
      <Title order={2} mb="md" data-reveal>{t('users.form.editTitle')}</Title>

      {isSelf && (
        <Alert icon={<AlertTriangle size={16} />} color="yellow" mb="md">
          {t('users.form.cantEditSelfRole')}
        </Alert>
      )}

      {!u.isActive && (
        <Paper withBorder shadow="sm" p="md" radius="md" mb="md" data-reveal>
          <Stack gap="sm">
            <Alert icon={<Mail size={16} />} color="yellow" variant="light">
              {t('users.edit.pendingBanner')}
            </Alert>
            <Group>
              <Button
                leftSection={<Mail size={16} />}
                onClick={handleResendInvite}
                loading={resendInvite.isPending}
              >
                {t('users.edit.resendInvite')}
              </Button>
            </Group>
            {inviteUrl && (
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  label={t('users.edit.inviteUrlLabel')}
                  value={inviteUrl}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1 }}
                />
                <CopyButton value={inviteUrl}>
                  {({ copied, copy }) => (
                    <Button variant="light" leftSection={<Copy size={16} />} onClick={copy}>
                      {copied ? '✓' : t('users.form.copyLink')}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            )}
          </Stack>
        </Paper>
      )}

      <Paper withBorder shadow="sm" p="lg" radius="md" data-reveal>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            {/* Email editable until first login; read-only afterwards. */}
            <TextInput
              label={t('users.fields.email')}
              {...form.getInputProps('email')}
              required
              readOnly={!emailEditable}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              description={
                emailEditable
                  ? t('users.fields.emailEditableHint', { defaultValue: 'Можна змінити поки користувач не увійшов уперше' })
                  : t('users.fields.emailLockedHint', { defaultValue: 'Email заблоковано — користувач уже входив у систему' })
              }
              styles={!emailEditable ? { input: { backgroundColor: 'var(--mantine-color-gray-1)', cursor: 'not-allowed' } } : undefined}
            />
            <Group grow>
              <TextInput label={t('users.fields.firstName')} {...form.getInputProps('firstName')} required />
              <TextInput label={t('users.fields.lastName')} {...form.getInputProps('lastName')} required />
            </Group>
            <Select
              label={t('users.fields.role')}
              data={ROLE_OPTIONS.map((r) => ({ value: r, label: t(`users.role.${r}`) }))}
              {...form.getInputProps('role')}
              disabled={isSelf}
              w={240}
            />
            {!isSelf && (
              <Switch
                label={t('users.fields.isActive')}
                checked={form.values.isActive}
                onChange={(e) => form.setFieldValue('isActive', e.currentTarget.checked)}
              />
            )}
            <Switch
              label={t('users.fields.isFreelancer')}
              description={t('users.fields.isFreelancerHint')}
              checked={form.values.isFreelancer}
              onChange={(e) => form.setFieldValue('isFreelancer', e.currentTarget.checked)}
            />
            <Group justify="flex-end" mt="md">
              <Button variant="subtle" onClick={() => navigate(`/admin/users/${u.id}`)}>
                {t('users.form.cancel', { defaultValue: 'Anuluj' })}
              </Button>
              <Button type="submit" loading={update.isPending}>
                {t('users.form.submitSave')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper withBorder shadow="sm" p="md" radius="md" mt="md" data-reveal>
        <Stack gap="xs">
          <Title order={5}>{t('users.detail.resetPassword')}</Title>
          <Group>
            <Button
              variant="light"
              leftSection={<Key size={16} />}
              onClick={handleResetPassword}
              loading={resetPassword.isPending}
            >
              {t('users.detail.resetPassword')}
            </Button>
            <Button
              variant="light"
              color="orange"
              leftSection={<LogOut size={16} />}
              onClick={handleForceLogout}
              loading={forceLogout.isPending}
            >
              {t('users.detail.forceLogout')}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}

export function UserEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: user, isPending } = useAdminUser(id);
  if (isPending || !user) return <Splash />;
  return <UserEditInner user={user} />;
}
