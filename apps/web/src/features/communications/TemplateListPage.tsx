import { Box, Button, Group, Paper, Select, Stack, TextInput, Title } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsString, parseAsInteger, useQueryStates } from 'nuqs';
import { useTemplates } from './api';
import { buildTemplateColumns } from './columns';
import { useAuthStore } from '@/lib/auth-store';
import { PaginationBar } from '@/components/PaginationBar';

export function TemplateListPage() {
  const { t } = useTranslation('communications');
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === 'admin' || role === 'recruiter';

  const [filters, setFilters] = useQueryStates({
    q: parseAsString.withDefault(''),
    channel: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
  });

  const { data, isPending } = useTemplates({
    q: filters.q || undefined,
    channel: (filters.channel as 'email' | 'sms') || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  });

  const columns = buildTemplateColumns(t);

  return (
    <Stack>
      <Group justify="space-between" data-reveal>
        <Title order={2}>{t('templates.list.title')}</Title>
        <Group>
          {canManage && (
            <Button leftSection={<Plus size={16} />} onClick={() => navigate('/communications/new')}>
              {t('templates.list.add')}
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/communications/send')}>
            Bulk Send
          </Button>
          <Button variant="subtle" onClick={() => navigate('/communications/history')}>
            History
          </Button>
        </Group>
      </Group>
      <Paper withBorder radius="md" p="md" shadow="xs" data-reveal>
        <Group>
          <TextInput
            leftSection={<Search size={14} />}
            placeholder={t('templates.list.search')}
            value={filters.q}
            onChange={(e) => setFilters({ q: e.currentTarget.value, page: 1 })}
            w={260}
          />
          <Select
            placeholder={t('templates.list.filters.allChannels')}
            data={[
              { value: 'email', label: t('templates.channel.email') },
              { value: 'sms', label: t('templates.channel.sms') },
            ]}
            value={filters.channel || null}
            onChange={(v) => setFilters({ channel: v ?? '', page: 1 })}
            clearable
            w={160}
          />
        </Group>
      </Paper>
      <Paper withBorder radius="md" shadow="sm" data-reveal>
        <Box style={{ overflowX: 'auto' }}>
          <DataTable
            records={data?.items ?? []}
            columns={columns}
            fetching={isPending}
            noRecordsText={data?.items && data.items.length > 0 ? '' : t('templates.list.empty')}
            noRecordsIcon={<></>}
            minHeight={data?.items && data.items.length > 0 ? undefined : 200}
            onRowClick={({ record }) => navigate(`/communications/${record.id}`)}
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
    </Stack>
  );
}
