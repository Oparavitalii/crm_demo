import { Badge, Text, Tooltip } from '@mantine/core';
import { Lock, ShieldCheck } from 'lucide-react';
import type { AdminUser, UserRole } from '@crm/shared';
import type { TFunction } from 'i18next';

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'red',
  recruiter: 'blue',
  coordinator: 'teal',
  readonly: 'gray',
};

interface ColumnsOptions {
  onToggleFreelancer?: (u: AdminUser) => void;
  toggling?: boolean;
}

export function buildColumns(t: TFunction<'admin'>, opts: ColumnsOptions = {}) {
  return [
    {
      accessor: 'lastName',
      title: t('users.fields.lastName'),
      render: (u: AdminUser) => (
        <strong>
          {u.lastName} {u.firstName}
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
      render: (u: AdminUser) => (
        <Badge color={ROLE_COLORS[u.role]} variant="light">
          {t(`users.role.${u.role}`)}
        </Badge>
      ),
    },
    {
      accessor: 'isFreelancer',
      title: t('users.fields.employmentType'),
      render: (u: AdminUser) => (
        <Tooltip label={t('users.employmentType.toggleHint')} withArrow>
          <Badge
            color={u.isFreelancer ? 'orange' : 'indigo'}
            variant="light"
            style={{ cursor: opts.onToggleFreelancer ? 'pointer' : undefined, opacity: opts.toggling ? 0.6 : 1 }}
            onClick={(e) => {
              e.stopPropagation();
              opts.onToggleFreelancer?.(u);
            }}
          >
            {u.isFreelancer ? t('users.employmentType.freelancer') : t('users.employmentType.own')}
          </Badge>
        </Tooltip>
      ),
    },
    {
      accessor: 'isActive',
      title: t('users.fields.isActive'),
      render: (u: AdminUser) => {
        // Two distinct "inactive" states share the same flag in the DB but
        // mean very different things to an admin:
        //   - never logged in → invitation has not been accepted yet
        //   - logged in before → account was deactivated by an admin
        // Conflating them was misleading admins into hitting "Activate" on
        // never-registered users, which is a no-op for login (no password).
        if (!u.isActive) {
          if (!u.lastLoginAt) {
            return (
              <Badge color="yellow" variant="light">
                {t('users.badge.pending')}
              </Badge>
            );
          }
          return (
            <Badge color="gray" variant="light">
              {t('users.badge.deactivated')}
            </Badge>
          );
        }
        if (!u.lastLoginAt) {
          return (
            <Badge color="orange" variant="light">
              {t('users.badge.neverLoggedIn')}
            </Badge>
          );
        }
        return (
          <Badge color="green" variant="light">
            {t('users.badge.active')}
          </Badge>
        );
      },
    },
    {
      accessor: 'has2FA',
      title: t('users.fields.twoFactor', { defaultValue: '2FA' }),
      render: (u: AdminUser) =>
        u.has2FA ? (
          <Tooltip label={t('users.fields.twoFactorOn', { defaultValue: '2FA увімкнено' })}>
            <ShieldCheck size={16} color="var(--mantine-color-green-6)" />
          </Tooltip>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    },
    {
      accessor: 'failedLoginAttempts',
      title: t('users.fields.failedLogins', { defaultValue: 'Невдалі входи' }),
      render: (u: AdminUser) => {
        const n = u.failedLoginAttempts ?? 0;
        if (n === 0) return <Text c="dimmed">—</Text>;
        return (
          <Badge variant="light" color={n >= 3 ? 'red' : 'orange'}>
            {n}
          </Badge>
        );
      },
    },
    {
      accessor: 'lockedUntil',
      title: t('users.fields.lockedUntil', { defaultValue: 'Заблокований до' }),
      render: (u: AdminUser) => {
        if (!u.lockedUntil) return <Text c="dimmed">—</Text>;
        const lockUntil = new Date(u.lockedUntil);
        const isLocked = lockUntil.getTime() > Date.now();
        return (
          <Tooltip label={lockUntil.toLocaleString()}>
            <Badge variant="light" color={isLocked ? 'red' : 'gray'} leftSection={isLocked ? <Lock size={10} /> : null}>
              {isLocked ? lockUntil.toLocaleString() : t('users.lock.expired', { defaultValue: 'минув' })}
            </Badge>
          </Tooltip>
        );
      },
    },
    {
      accessor: 'lastLoginAt',
      title: t('users.fields.lastLoginAt'),
      render: (u: AdminUser) =>
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—',
    },
    {
      accessor: 'createdAt',
      title: t('users.fields.createdAt'),
      render: (u: AdminUser) => new Date(u.createdAt).toLocaleDateString(),
    },
    {
      accessor: 'updatedAt',
      title: t('users.fields.updatedAt', { defaultValue: 'Оновлено' }),
      render: (u: AdminUser) =>
        u.updatedAt ? new Date(u.updatedAt).toLocaleString() : '—',
    },
  ];
}

export { ROLE_COLORS };
