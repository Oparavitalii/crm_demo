import { Button, Group, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import { createUserSchema, type CreateUserInput, type UserRole } from '@opushr/shared';
import { useIsMobile } from '@/lib/use-is-mobile';

const ROLE_OPTIONS: UserRole[] = ['admin', 'recruiter', 'coordinator', 'readonly'];

interface Props {
  initial?: Partial<CreateUserInput>;
  onSubmit: (values: CreateUserInput) => void;
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  emailReadOnly?: boolean;
}

export function UserForm({ initial, onSubmit, submitting, submitLabel, onCancel, emailReadOnly }: Props) {
  const { t } = useTranslation('admin');
  const isMobile = useIsMobile();

  const form = useForm<CreateUserInput>({
    initialValues: {
      email: initial?.email ?? '',
      firstName: initial?.firstName ?? '',
      lastName: initial?.lastName ?? '',
      role: initial?.role ?? 'recruiter',
      isFreelancer: initial?.isFreelancer ?? false,
      sendInvite: initial?.sendInvite ?? true,
    },
    validate: zodResolver(createUserSchema),
  });

  const isFreelancer = form.values.isFreelancer;
  // Freelancers are source-tag accounts: never a login, always no email invite,
  // always role=recruiter so they show up in the candidate owner/source picker.
  const sendInvite = isFreelancer ? false : form.values.sendInvite;

  function setType(value: string) {
    const freelancer = value === 'freelancer';
    form.setFieldValue('isFreelancer', freelancer);
    if (freelancer) {
      form.setFieldValue('sendInvite', false);
      form.setFieldValue('role', 'recruiter');
    }
  }

  const firstNameInput = (
    <TextInput
      label={t('users.fields.firstName')}
      {...form.getInputProps('firstName')}
      required
      autoComplete="given-name"
      autoCapitalize="words"
    />
  );
  const lastNameInput = (
    <TextInput
      label={t('users.fields.lastName')}
      {...form.getInputProps('lastName')}
      required
      autoComplete="family-name"
      autoCapitalize="words"
    />
  );

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack>
        <div>
          <Text size="sm" fw={500} mb={4}>{t('users.form.typeLabel')}</Text>
          <SegmentedControl
            fullWidth={isMobile}
            value={isFreelancer ? 'freelancer' : 'staff'}
            onChange={setType}
            data={[
              { value: 'staff', label: t('users.form.typeStaff') },
              { value: 'freelancer', label: t('users.form.typeFreelancer') },
            ]}
          />
        </div>

        {!isFreelancer && (
          <div>
            <Text size="sm" fw={500} mb={4}>{t('users.form.methodLabel')}</Text>
            <SegmentedControl
              fullWidth={isMobile}
              value={sendInvite ? 'invite' : 'no_login'}
              onChange={(v) => form.setFieldValue('sendInvite', v === 'invite')}
              data={[
                { value: 'invite', label: t('users.form.methodInvite') },
                { value: 'no_login', label: t('users.form.methodNoLogin') },
              ]}
            />
          </div>
        )}

        <TextInput
          label={t('users.fields.email')}
          description={sendInvite ? undefined : t('users.form.emailOptional')}
          {...form.getInputProps('email')}
          required={sendInvite}
          readOnly={emailReadOnly}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          styles={emailReadOnly ? { input: { backgroundColor: 'var(--mantine-color-gray-1)', cursor: 'not-allowed' } } : undefined}
        />
        {isMobile ? (
          <Stack gap="sm">
            {firstNameInput}
            {lastNameInput}
          </Stack>
        ) : (
          <Group grow>
            {firstNameInput}
            {lastNameInput}
          </Group>
        )}
        {!isFreelancer && (
          <Select
            label={t('users.fields.role')}
            data={ROLE_OPTIONS.map((r) => ({ value: r, label: t(`users.role.${r}`) }))}
            {...form.getInputProps('role')}
            required
            w={isMobile ? '100%' : 240}
          />
        )}
        {isMobile ? (
          <Group
            grow
            style={{
              position: 'sticky',
              bottom: 0,
              background: 'var(--mantine-color-body)',
              paddingTop: 'var(--mantine-spacing-sm)',
              paddingBottom: 'calc(var(--mantine-spacing-sm) + env(safe-area-inset-bottom))',
              borderTop: '1px solid var(--mantine-color-default-border)',
              margin: '0 calc(-1 * var(--mantine-spacing-md))',
              paddingLeft: 'var(--mantine-spacing-md)',
              paddingRight: 'var(--mantine-spacing-md)',
              zIndex: 1,
            }}
          >
            <Button variant="default" onClick={onCancel} size="md">
              {t('users.form.cancel', { defaultValue: 'Anuluj' })}
            </Button>
            <Button type="submit" loading={submitting} size="md">
              {submitLabel}
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onCancel}>
              {t('users.form.cancel', { defaultValue: 'Anuluj' })}
            </Button>
            <Button type="submit" loading={submitting}>
              {submitLabel}
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  );
}
