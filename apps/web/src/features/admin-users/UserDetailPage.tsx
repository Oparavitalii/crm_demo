import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Container,
  CopyButton,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ArrowLeft, Copy, Edit, Key, LogOut, Mail, Trash2, UserX, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { AdminUser, AuditLogEntry } from '@crm/shared';
import { useAuthStore } from '@/lib/auth-store';
import { Splash } from '@/components/Splash';
import { parseApiError } from '@/lib/http';
import { useAuditLog } from '@/features/admin-audit/api';
import {
  useAdminUser,
  useResetAdminUserPassword,
  useForceLogoutAdminUser,
  useDeleteAdminUser,
  useUpdateAdminUser,
  useResendInvite,
} from './api';
import { ROLE_COLORS } from './columns';

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text c="dimmed" size="sm">{label}</Text>
      <Text>{value || '—'}</Text>
    </Group>
  );
}

type ExtendedAdminUser = AdminUser & {
  failedLoginAttempts?: number | null;
  lockedUntil?: string | null;
  twoFactorSecret?: string | null;
};

function BasicInfoPaper({ u }: { u: ExtendedAdminUser }) {
  const { t } = useTranslation('admin');
  const has2fa = u.has2FA || Boolean(u.twoFactorSecret);
  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Title order={4} mb="sm">{t('users.detail.basicInfo')}</Title>
      <Stack>
        <FieldRow label={t('users.fields.email')} value={u.email} />
        <FieldRow label={t('users.fields.firstName')} value={u.firstName} />
        <FieldRow label={t('users.fields.lastName')} value={u.lastName} />
        <FieldRow
          label={t('users.fields.role')}
          value={
            <Badge color={ROLE_COLORS[u.role]} variant="light">
              {t(`users.role.${u.role}`)}
            </Badge>
          }
        />
        <FieldRow
          label={t('users.fields.isActive')}
          value={<Badge color={u.isActive ? 'green' : 'red'} variant="dot">{u.isActive ? '✓' : '✗'}</Badge>}
        />
        <FieldRow
          label={t('users.detail.twoFactor')}
          value={
            <Badge color={has2fa ? 'green' : 'gray'} variant="light">
              {has2fa ? t('users.detail.twoFactorOn') : t('users.detail.twoFactorOff')}
            </Badge>
          }
        />
      </Stack>
    </Paper>
  );
}

function AccountStatusPaper({ u }: { u: ExtendedAdminUser }) {
  const { t } = useTranslation('admin');
  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Title order={4} mb="sm">{t('users.detail.accountStatus')}</Title>
      <Stack>
        <FieldRow
          label={t('users.fields.lastLoginAt')}
          value={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
        />
        <FieldRow
          label={t('users.detail.failedLoginAttempts')}
          value={typeof u.failedLoginAttempts === 'number' ? String(u.failedLoginAttempts) : '—'}
        />
        <FieldRow
          label={t('users.detail.lockedUntil')}
          value={u.lockedUntil ? new Date(u.lockedUntil).toLocaleString() : '—'}
        />
        <FieldRow
          label={t('users.fields.createdAt')}
          value={new Date(u.createdAt).toLocaleString()}
        />
      </Stack>
    </Paper>
  );
}

function AuditTable({ items, emptyText }: { items: AuditLogEntry[]; emptyText: string }) {
  const { t } = useTranslation('admin');
  if (!items.length) {
    return <Text c="dimmed" size="sm">{emptyText}</Text>;
  }
  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('auditLog.timestamp')}</Table.Th>
          <Table.Th>{t('auditLog.action')}</Table.Th>
          <Table.Th>{t('auditLog.entityType')}</Table.Th>
          <Table.Th>{t('auditLog.entityId')}</Table.Th>
          <Table.Th>{t('auditLog.ip')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((item) => (
          <Table.Tr key={item.id}>
            <Table.Td>
              <Text size="xs" c="dimmed">{new Date(item.createdAt).toLocaleString()}</Text>
            </Table.Td>
            <Table.Td>
              <Badge variant="light" size="sm">{t(`actions.${item.action}`, item.action)}</Badge>
            </Table.Td>
            <Table.Td><Text size="xs">{item.entityType}</Text></Table.Td>
            <Table.Td>
              <Code style={{ fontSize: 11 }}>{item.entityId ?? '—'}</Code>
            </Table.Td>
            <Table.Td><Text size="xs" c="dimmed">{item.ip ?? '—'}</Text></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ActivityPaper({ userId }: { userId: string }) {
  const { t } = useTranslation('admin');
  const { data, isPending } = useAuditLog({ actorId: userId, page: 1, pageSize: 20 });
  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Title order={4} mb="sm">{t('users.detail.activity')}</Title>
      {isPending ? (
        <Text c="dimmed" size="sm">...</Text>
      ) : (
        <AuditTable items={data?.items ?? []} emptyText={t('users.detail.noActivity')} />
      )}
    </Paper>
  );
}

function AuditChangesPaper({ userId }: { userId: string }) {
  const { t } = useTranslation('admin');
  const { data, isPending } = useAuditLog({
    entityType: 'user',
    entityId: userId,
    page: 1,
    pageSize: 20,
  });
  return (
    <Paper withBorder shadow="sm" p="lg" radius="md">
      <Title order={4} mb="sm">{t('users.detail.auditChanges')}</Title>
      {isPending ? (
        <Text c="dimmed" size="sm">...</Text>
      ) : (
        <AuditTable items={data?.items ?? []} emptyText={t('users.detail.noChanges')} />
      )}
    </Paper>
  );
}

function UserDetailInner({ user: u }: { user: ExtendedAdminUser }) {
  const { t } = useTranslation(['admin', 'errors']);
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const resetPassword = useResetAdminUserPassword();
  const forceLogout = useForceLogoutAdminUser();
  const deleteUser = useDeleteAdminUser();
  const updateUser = useUpdateAdminUser(u.id);
  const resendInvite = useResendInvite();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const isSelf = currentUserId === u.id;
  // A user that has never logged in can't be "activated" — flipping the flag
  // leaves them without a usable password. The correct action is to (re)send
  // an invitation so they set their own. We pick which button to render
  // based on lastLoginAt instead of isActive alone.
  const neverRegistered = !u.isActive && !u.lastLoginAt;

  function handleResetPassword() {
    modals.openConfirmModal({
      title: t('users.detail.resetPassword'),
      children: <Text size="sm">{t('users.detail.resetConfirm')}</Text>,
      labels: { confirm: t('users.detail.resetPassword'), cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }) },
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
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message: code === 'NOT_FOUND' ? t('users.errors.notFound') : t('users.errors.generic'),
            });
          },
        });
      },
    });
  }

  function handleForceLogout() {
    modals.openConfirmModal({
      title: t('users.detail.forceLogout'),
      children: <Text size="sm">{t('users.detail.forceLogoutConfirm')}</Text>,
      labels: { confirm: t('users.detail.forceLogout'), cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }) },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        forceLogout.mutate(u.id, {
          onSuccess: (res) => {
            notifications.show({
              color: 'green',
              message: `${t('users.detail.forceLogout')}: ${res.sessionsDeleted}`,
            });
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message: code === 'NOT_FOUND' ? t('users.errors.notFound') : t('users.errors.generic'),
            });
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

  function handleToggleActive() {
    if (isSelf && u.isActive) {
      notifications.show({ color: 'orange', message: t('users.errors.selfProtection') });
      return;
    }
    const action = u.isActive ? t('users.detail.deactivate') : t('users.detail.activate');
    modals.openConfirmModal({
      title: action,
      children: <Text size="sm">{action + '?'}</Text>,
      labels: { confirm: action, cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }) },
      confirmProps: { color: u.isActive ? 'red' : 'green' },
      onConfirm: () => {
        updateUser.mutate({ isActive: !u.isActive }, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('users.form.submitSave') });
            navigate('/admin/users');
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            const msg =
              code === 'FORBIDDEN'
                ? t('users.errors.selfProtection')
                : t('users.errors.generic');
            notifications.show({ color: 'red', message: msg });
          },
        });
      },
    });
  }

  function handleDelete() {
    if (isSelf) {
      notifications.show({ color: 'orange', message: t('users.errors.selfProtection') });
      return;
    }
    const fullName = `${u.lastName} ${u.firstName}`.trim();
    modals.openConfirmModal({
      title: t('users.detail.delete'),
      children: <Text size="sm">{t('users.detail.deleteConfirm', { name: fullName })}</Text>,
      labels: { confirm: t('users.detail.delete'), cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }) },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        deleteUser.mutate(u.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('users.detail.deleteSuccess') });
            navigate('/admin/users');
          },
          onError: (err: unknown) => {
            const { code } = parseApiError(err);
            const msg =
              code === 'FORBIDDEN'
                ? t('users.errors.selfProtection')
                : code === 'NOT_FOUND'
                  ? t('users.errors.notFound')
                  : t('users.errors.generic');
            notifications.show({ color: 'red', message: msg });
          },
        });
      },
    });
  }

  return (
    <Container size="md">
      <Flex
        direction={{ base: 'column', lg: 'row' }}
        justify="space-between"
        align={{ base: 'stretch', lg: 'center' }}
        gap="md"
        mb="md"
      >
        <Group gap="sm">
          <Button variant="subtle" leftSection={<ArrowLeft size={16} />} onClick={() => navigate('/admin/users')}>
            {t('users.list.title')}
          </Button>
          <Title order={2} data-reveal>{u.lastName} {u.firstName}</Title>
          <Badge color={ROLE_COLORS[u.role]} variant="light">
            {t(`users.role.${u.role}`)}
          </Badge>
          {neverRegistered && (
            <Badge color="yellow" variant="filled">{t('users.badge.pending')}</Badge>
          )}
          {!u.isActive && !neverRegistered && (
            <Badge color="gray" variant="filled">{t('users.badge.deactivated')}</Badge>
          )}
        </Group>
        <Group gap="sm">
          <Button leftSection={<Edit size={16} />} onClick={() => navigate(`/admin/users/${u.id}/edit`)}>
            {t('users.detail.edit')}
          </Button>
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
          {!isSelf && neverRegistered && (
            <Button
              variant="light"
              color="blue"
              leftSection={<Mail size={16} />}
              onClick={handleResendInvite}
              loading={resendInvite.isPending}
            >
              {t('users.edit.resendInvite')}
            </Button>
          )}
          {!isSelf && !neverRegistered && (
            <Button
              variant="light"
              color={u.isActive ? 'red' : 'green'}
              leftSection={u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
              onClick={handleToggleActive}
              loading={updateUser.isPending}
            >
              {u.isActive ? t('users.detail.deactivate') : t('users.detail.activate')}
            </Button>
          )}
          {!isSelf && (
            <Button
              variant="light"
              color="red"
              leftSection={<Trash2 size={16} />}
              onClick={handleDelete}
              loading={deleteUser.isPending}
            >
              {t('users.detail.delete')}
            </Button>
          )}
        </Group>
      </Flex>

      {neverRegistered && (
        <Alert icon={<Mail size={16} />} color="yellow" variant="light" mb="md" data-reveal>
          {t('users.edit.pendingBanner')}
        </Alert>
      )}

      {u.publicSlug && u.isActive && (
        <Paper withBorder shadow="sm" p="md" radius="md" mb="md" data-reveal>
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {t('users.detail.applyLinkTitle')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('users.detail.applyLinkHint')}
            </Text>
            <Group align="flex-end" gap="sm">
              <TextInput
                value={`${window.location.origin}/apply/${u.publicSlug}`}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                miw={200}
                style={{ flex: 1 }}
              />
              <CopyButton value={`${window.location.origin}/apply/${u.publicSlug}`}>
                {({ copied, copy }) => (
                  <Button variant="light" leftSection={<Copy size={16} />} onClick={copy}>
                    {copied ? t('users.form.copyLink') + ' ✓' : t('users.form.copyLink')}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        </Paper>
      )}

      {inviteUrl && (
        <Paper withBorder shadow="sm" p="md" radius="md" mb="md" data-reveal>
          <Stack gap="xs">
            <Text size="sm" c="yellow.7">
              {t('users.edit.resendSuccessNoEmail')}
            </Text>
            <Group align="flex-end" gap="sm">
              <TextInput
                label={t('users.edit.inviteUrlLabel')}
                value={inviteUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                miw={200}
                style={{ flex: 1 }}
              />
              <CopyButton value={inviteUrl}>
                {({ copied, copy }) => (
                  <Button variant="light" leftSection={<Copy size={16} />} onClick={copy}>
                    {copied ? t('users.form.copyLink') + ' ✓' : t('users.form.copyLink')}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        </Paper>
      )}

      <Tabs defaultValue="info" data-reveal>
        <Tabs.List mb="md">
          <Tabs.Tab value="info">{t('users.detail.infoTab')}</Tabs.Tab>
          <Tabs.Tab value="full">{t('users.detail.fullTab')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="info">
          <Paper withBorder shadow="sm" p="lg" radius="md">
            <Stack>
              <FieldRow label={t('users.fields.email')} value={u.email} />
              <FieldRow label={t('users.fields.firstName')} value={u.firstName} />
              <FieldRow label={t('users.fields.lastName')} value={u.lastName} />
              <FieldRow
                label={t('users.fields.role')}
                value={
                  <Badge color={ROLE_COLORS[u.role]} variant="light">
                    {t(`users.role.${u.role}`)}
                  </Badge>
                }
              />
              <FieldRow
                label={t('users.fields.isActive')}
                value={<Badge color={u.isActive ? 'green' : 'red'} variant="dot">{u.isActive ? '✓' : '✗'}</Badge>}
              />
              <Divider />
              <FieldRow
                label={t('users.fields.lastLoginAt')}
                value={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
              />
              <FieldRow
                label={t('users.fields.createdAt')}
                value={new Date(u.createdAt).toLocaleString()}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="full">
          <Stack>
            <BasicInfoPaper u={u} />
            <AccountStatusPaper u={u} />
            <ActivityPaper userId={u.id} />
            <AuditChangesPaper userId={u.id} />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: user, isPending } = useAdminUser(id);

  if (isPending || !user) return <Splash />;
  return <UserDetailInner user={user as ExtendedAdminUser} />;
}
