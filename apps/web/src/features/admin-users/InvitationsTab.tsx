import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CopyButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { DataTable } from 'mantine-datatable';
import { Copy, Mail, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PendingInvitation } from '@opushr/shared';
import { parseApiError } from '@/lib/http';
import { useInvitations, useResendInvitation, useRevokeInvitation } from './api';
import { ROLE_COLORS } from './columns';

function daysLeft(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export function InvitationsTab() {
  const { t } = useTranslation(['admin', 'errors']);
  const { data, isPending } = useInvitations();
  const revoke = useRevokeInvitation();
  const resend = useResendInvitation();
  // When Resend succeeds but email delivery fails, we surface the new link
  // inline so the admin can hand it over manually. Email is the same string
  // we already show in the row, so keep only the URL here.
  const [resendUrl, setResendUrl] = useState<{ email: string; url: string } | null>(null);

  function handleResend(inv: PendingInvitation) {
    if (resend.isPending) return;
    resend.mutate(inv.id, {
      onSuccess: (res) => {
        if (res.emailSent) {
          setResendUrl(null);
          notifications.show({
            color: 'green',
            message: t('users.edit.resendSuccess', { email: res.email }),
          });
        } else if (res.inviteUrl) {
          setResendUrl({ email: res.email, url: res.inviteUrl });
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

  function handleRevoke(inv: PendingInvitation) {
    modals.openConfirmModal({
      title: t('users.invitations.revoke'),
      children: (
        <Text size="sm">
          {t('users.invitations.revokeConfirm', { email: inv.email })}
        </Text>
      ),
      labels: {
        confirm: t('users.invitations.revoke'),
        cancel: t('users.form.cancel', { defaultValue: 'Anuluj' }),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        revoke.mutate(inv.id, {
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: t('users.invitations.revokeSuccess'),
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

  const items = data?.items ?? [];

  return (
    <Stack>
      <Group justify="space-between" data-reveal>
        <Title order={3}>{t('users.invitations.title')}</Title>
        <Text c="dimmed" size="sm">
          {t('users.invitations.count', { count: items.length })}
        </Text>
      </Group>

      {resendUrl && (
        <Paper withBorder shadow="sm" p="md" radius="md" data-reveal>
          <Stack gap="xs">
            <Text size="sm" c="yellow.7">
              {t('users.invitations.resendNoEmail', { email: resendUrl.email })}
            </Text>
            <Group align="flex-end" gap="sm">
              <TextInput
                label={t('users.edit.inviteUrlLabel')}
                value={resendUrl.url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                miw={200}
                style={{ flex: 1 }}
              />
              <CopyButton value={resendUrl.url}>
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

      <Paper withBorder radius="md" shadow="sm" data-reveal>
        <Box style={{ overflowX: 'auto' }}>
          <DataTable<PendingInvitation>
            records={items}
            fetching={isPending}
            noRecordsText={items.length > 0 ? '' : t('users.invitations.empty')}
            noRecordsIcon={<></>}
            minHeight={items.length > 0 ? undefined : 200}
            highlightOnHover
            striped
            columns={[
              {
                accessor: 'name',
                title: t('users.fields.lastName'),
                render: (inv) => (
                  <strong>
                    {inv.lastName} {inv.firstName}
                  </strong>
                ),
              },
              {
                accessor: 'email',
                title: t('users.fields.email'),
              },
              {
                accessor: 'role',
                title: t('users.fields.role'),
                render: (inv) => (
                  <Badge color={ROLE_COLORS[inv.role]} variant="light">
                    {t(`users.role.${inv.role}`)}
                  </Badge>
                ),
              },
              {
                accessor: 'createdAt',
                title: t('users.invitations.createdAt'),
                render: (inv) => new Date(inv.createdAt).toLocaleString(),
              },
              {
                accessor: 'expiresAt',
                title: t('users.invitations.expiresAt'),
                render: (inv) => {
                  const days = daysLeft(inv.expiresAt);
                  return (
                    <Badge color={days <= 1 ? 'red' : days <= 2 ? 'orange' : 'blue'} variant="light">
                      {t('users.invitations.daysLeft', { count: days })}
                    </Badge>
                  );
                },
              },
              {
                accessor: 'actions',
                title: '',
                width: 260,
                render: (inv) => (
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="blue"
                      leftSection={<Mail size={14} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResend(inv);
                      }}
                      loading={resend.isPending && resend.variables === inv.id}
                    >
                      {t('users.invitations.resend')}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<Trash2 size={14} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevoke(inv);
                      }}
                      loading={revoke.isPending && revoke.variables === inv.id}
                    >
                      {t('users.invitations.revoke')}
                    </Button>
                  </Group>
                ),
              },
            ]}
          />
        </Box>
      </Paper>
    </Stack>
  );
}
