import { useState } from 'react';
import { Container, Paper, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CreateUserInput } from '@opushr/shared';
import { parseApiError } from '@/lib/http';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useInviteUser, useCreateAdminUser } from './api';
import { UserForm } from './UserForm';

export function UserCreatePage() {
  const { t } = useTranslation(['admin', 'errors']);
  const navigate = useNavigate();
  const invite = useInviteUser();
  const createUser = useCreateAdminUser();
  const isMobile = useIsMobile();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  function handleError(err: unknown) {
    const { code, meta } = parseApiError(err);
    const reason = meta?.reason as string | undefined;
    const message =
      code === 'FORBIDDEN'
        ? t('users.errors.forbidden')
        : code === 'DUPLICATE' && reason === 'invitation_pending'
          ? t('users.errors.invitationPending')
          : code === 'DUPLICATE'
            ? t('users.errors.userExists')
            : t('users.errors.generic');
    notifications.show({ color: 'red', message, autoClose: 8000 });
  }

  function submit(values: CreateUserInput) {
    // No-login mode (freelancers + any account created without an email) goes
    // straight to createUser — no invitation record, no email. Staff with an
    // email invite keeps the existing invitation flow (pending-invites tab).
    if (values.isFreelancer || !values.sendInvite) {
      createUser.mutate(values, {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('users.form.createdNoLogin') });
          navigate('/admin/users');
        },
        onError: handleError,
      });
      return;
    }

    invite.mutate(
      { email: values.email as string, firstName: values.firstName, lastName: values.lastName, role: values.role },
      {
        onSuccess: (result) => {
          if (result.emailSent) {
            notifications.show({ color: 'green', message: t('users.form.invitationSent') });
            navigate('/admin/users');
          } else {
            // Email failed — show copyable link inline
            setInviteUrl(result.inviteUrl);
            notifications.show({
              color: 'yellow',
              autoClose: false,
              message: t('users.form.inviteLinkBelow'),
            });
          }
        },
        onError: handleError,
      },
    );
  }

  return (
    <Container size="md">
      <Title order={isMobile ? 3 : 2} mb={isMobile ? 'xs' : 'md'} data-reveal>{t('users.form.createTitle')}</Title>
      <Paper
        {...(isMobile
          ? ({ p: 'md', shadow: 'none', radius: 0 } as const)
          : ({ withBorder: true, shadow: 'sm', p: 'lg', radius: 'md' } as const))}
        data-reveal
      >
        {inviteUrl ? (
          <>
            <Text mb="sm" c="yellow.7">{t('users.form.inviteLinkBelow')}</Text>
            <TextInput
              label={t('users.form.inviteUrl')}
              value={inviteUrl}
              readOnly
              mb="md"
              rightSection={
                <Text
                  size="xs"
                  c="blue"
                  style={{ cursor: 'pointer' }}
                  onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                >
                  {t('users.form.copyLink')}
                </Text>
              }
              rightSectionWidth={80}
            />
          </>
        ) : (
          <UserForm
            onSubmit={submit}
            submitting={invite.isPending || createUser.isPending}
            submitLabel={t('users.form.submitCreate')}
            onCancel={() => navigate('/admin/users')}
          />
        )}
      </Paper>
    </Container>
  );
}
