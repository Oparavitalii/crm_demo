import { Box, Button, Chip, Group, Paper, Select, Stack, Tabs, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { DataTable } from 'mantine-datatable';
import { Mail, Plus, Search, Users as UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsString, parseAsInteger, parseAsBoolean, useQueryStates } from 'nuqs';
import type { AdminUser, UserRole } from '@opushr/shared';
import { useAdminUsers, useInvitations } from './api';
import { apiFetch } from '@/lib/http';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { buildColumns } from './columns';
import { PaginationBar } from '@/components/PaginationBar';
import { DateRangeFilter, type DateRangePresetValue } from '@/components/DateRangeFilter';
import { InvitationsTab } from './InvitationsTab';

const ROLE_OPTIONS: UserRole[] = ['admin', 'recruiter', 'coordinator', 'readonly'];

export function UserListPage() {
  const { t } = useTranslation('admin');
  const apiErrorMessage = useApiErrorMessage();
  const navigate = useNavigate();

  const [filters, setFilters] = useQueryStates({
    tab: parseAsString.withDefault('users'),
    q: parseAsString.withDefault(''),
    role: parseAsString.withDefault(''),
    isActive: parseAsBoolean,
    isFreelancer: parseAsBoolean,
    has2fa: parseAsBoolean,
    preset: parseAsString.withDefault('all'),
    from: parseAsString.withDefault(''),
    to: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
  });

  const { data, isPending } = useAdminUsers(
    {
      q: filters.q || undefined,
      role: (filters.role as UserRole) || undefined,
      isActive: filters.isActive ?? undefined,
      isFreelancer: filters.isFreelancer ?? undefined,
      has2fa: filters.has2fa ?? undefined,
      preset: (filters.preset as DateRangePresetValue) || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    },
    { enabled: filters.tab === 'users' },
  );

  // Always fetch invitations — the count drives the tab badge so users see at
  // a glance that something is waiting.
  const { data: invitationsData } = useInvitations();
  const pendingCount = invitationsData?.items.length ?? 0;

  const qc = useQueryClient();
  const toggleFreelancer = useMutation({
    mutationFn: ({ id, isFreelancer }: { id: string; isFreelancer: boolean }) =>
      apiFetch<AdminUser>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: { isFreelancer },
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  function handleToggleFreelancer(u: AdminUser) {
    if (toggleFreelancer.isPending) return;
    toggleFreelancer.mutate(
      { id: u.id, isFreelancer: !u.isFreelancer },
      {
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  }

  const columns = buildColumns(t, {
    onToggleFreelancer: handleToggleFreelancer,
    toggling: toggleFreelancer.isPending,
  });

  const triStateValue = (v: boolean | null) =>
    v === null ? null : v === true ? 'on' : 'off';
  const triStateParse = (v: string | null): boolean | null =>
    v === 'on' ? true : v === 'off' ? false : null;

  return (
    <Stack>
      <Group justify="space-between" data-reveal>
        <Title order={2}>{t('users.list.title')}</Title>
        <Button leftSection={<Plus size={16} />} onClick={() => navigate('/admin/users/new')}>
          {t('users.list.add')}
        </Button>
      </Group>

      <Tabs
        value={filters.tab}
        onChange={(v) => setFilters({ tab: v ?? 'users', page: 1 })}
        data-reveal
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="users" leftSection={<UsersIcon size={14} />}>
            {t('users.list.tabs.users')}
          </Tabs.Tab>
          <Tabs.Tab
            value="invitations"
            leftSection={<Mail size={14} />}
            rightSection={
              pendingCount > 0 ? (
                <Chip size="xs" checked={false} variant="filled" color="yellow" readOnly>
                  {pendingCount}
                </Chip>
              ) : null
            }
          >
            {t('users.list.tabs.invitations')}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="invitations">
          <InvitationsTab />
        </Tabs.Panel>

        <Tabs.Panel value="users">
      <Paper withBorder radius="md" p="md" shadow="xs" data-reveal>
        <Stack gap="sm">
          <Group>
            <TextInput
              leftSection={<Search size={14} />}
              placeholder={t('users.list.search')}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.currentTarget.value, page: 1 })}
              w={260}
            />
            <Select
              placeholder={t('users.list.filters.role')}
              data={ROLE_OPTIONS.map((r) => ({ value: r, label: t(`users.role.${r}`) }))}
              value={filters.role || null}
              onChange={(v) => setFilters({ role: v ?? '', page: 1 })}
              clearable
              w={180}
            />
            <Select
              placeholder={t('users.list.filters.isActive')}
              data={[
                { value: 'on', label: t('users.list.filters.on') },
                { value: 'off', label: t('users.list.filters.off') },
              ]}
              value={triStateValue(filters.isActive)}
              onChange={(v) => setFilters({ isActive: triStateParse(v), page: 1 })}
              clearable
              w={160}
            />
            <Select
              placeholder={t('users.list.filters.employmentType')}
              data={[
                { value: 'on', label: t('users.employmentType.freelancer') },
                { value: 'off', label: t('users.employmentType.own') },
              ]}
              value={triStateValue(filters.isFreelancer)}
              onChange={(v) => setFilters({ isFreelancer: triStateParse(v), page: 1 })}
              clearable
              w={160}
            />
            <Select
              placeholder={t('users.list.filters.has2fa')}
              data={[
                { value: 'on', label: t('users.list.filters.on') },
                { value: 'off', label: t('users.list.filters.off') },
              ]}
              value={triStateValue(filters.has2fa)}
              onChange={(v) => setFilters({ has2fa: triStateParse(v), page: 1 })}
              clearable
              w={160}
            />
          </Group>
          <Group>
            <Chip
              checked={filters.isActive === false}
              onChange={(checked) =>
                setFilters({ isActive: checked ? false : null, page: 1 })
              }
            >
              {t('users.filterPending')}
            </Chip>
          </Group>
          <DateRangeFilter
            preset={filters.preset}
            from={filters.from}
            to={filters.to}
            onChange={({ preset, from, to }) =>
              setFilters({
                preset,
                from: from ?? '',
                to: to ?? '',
                page: 1,
              })
            }
          />
        </Stack>
      </Paper>
      <Paper withBorder radius="md" shadow="sm" data-reveal>
        <Box style={{ overflowX: 'auto' }}>
          <DataTable
            records={data?.items ?? []}
            columns={columns}
            fetching={isPending}
            noRecordsText={data?.items && data.items.length > 0 ? '' : t('users.list.empty')}
            noRecordsIcon={<></>}
            minHeight={data?.items && data.items.length > 0 ? undefined : 200}
            onRowClick={({ record }) => navigate(`/admin/users/${record.id}`)}
            highlightOnHover
            striped
          />
        </Box>
        <PaginationBar
          page={filters.page}
          pageSize={filters.pageSize}
          total={data?.total ?? 0}
          onChange={(p) => setFilters({ page: p })}
        />
      </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
