import { Autocomplete, Group, Paper, Select, Stack, TextInput } from '@mantine/core';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { useProjects } from '@/features/projects/api';
import { useAdminUsers } from '@/features/admin-users/api';
import { useAuthStore } from '@/lib/auth-store';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

export interface DismissalRegistryFiltersValue {
  q: string;
  source: string | null;
  reason: string;
  reasonCode: string | null;
  projectId: string | null;
  recruiterId: string | null;
  coordinatorId: string | null;
  preset: string;
  from: string | null;
  to: string | null;
}

interface Props {
  value: DismissalRegistryFiltersValue;
  onChange: (next: Partial<DismissalRegistryFiltersValue> & { page: number }) => void;
}

export function DismissalRegistryFilters({ value, onChange }: Props) {
  const { t, i18n } = useTranslation('operations');
  const role = useAuthStore((s) => s.user?.role);
  const isManager = role === 'admin';

  const { data: sourcesLookup } = useStatusLookup('sources');
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');
  const { data: projectsData } = useProjects({ isActive: true, pageSize: 500 });
  const { data: usersData } = useAdminUsers({ pageSize: 100 }, { enabled: isManager });

  const sourceOptions = (sourcesLookup ?? []).map((r) => ({
    value: r.code,
    label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
  }));
  const reasonOptions = (reasonLookup ?? []).map((r) => ({
    value: r.code,
    label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
  }));
  const projectOptions = (projectsData?.items ?? []).map((p) => ({ value: p.id, label: p.name }));
  const recruiterOptions = (usersData?.items ?? [])
    .filter((u) => u.role === 'recruiter' || u.role === 'admin')
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }));
  const coordinatorOptions = (usersData?.items ?? [])
    .filter((u) => u.role === 'coordinator' || u.role === 'admin')
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }));

  return (
    <Paper withBorder radius="md" p="md" shadow="xs" data-reveal>
      <Stack gap="sm">
        <Group wrap="wrap">
          <TextInput
            leftSection={<Search size={14} />}
            placeholder={t('dismissalsRegistry.filters.searchPlaceholder', 'Imię lub nazwisko')}
            value={value.q}
            onChange={(e) => onChange({ q: e.currentTarget.value, page: 1 })}
            w={260}
          />
          <Select
            placeholder={t('dismissalsRegistry.filters.allSources')}
            data={sourceOptions}
            value={value.source}
            onChange={(v) => onChange({ source: v, page: 1 })}
            clearable
            w={200}
          />
          <Select
            placeholder={t('dismissalsRegistry.filters.allProjects', { defaultValue: 'Wszystkie projekty' })}
            data={projectOptions}
            value={value.projectId}
            onChange={(v) => onChange({ projectId: v, page: 1 })}
            clearable
            searchable
            w={200}
          />
          {isManager && (
            <Select
              placeholder={t('dismissalsRegistry.filters.allRecruiters', { defaultValue: 'Wszyscy rekruterzy' })}
              data={recruiterOptions}
              value={value.recruiterId}
              onChange={(v) => onChange({ recruiterId: v, page: 1 })}
              clearable
              searchable
              w={200}
            />
          )}
          {isManager && (
            <Select
              placeholder={t('dismissalsRegistry.filters.allCoordinators', { defaultValue: 'Wszyscy koordynatorzy' })}
              data={coordinatorOptions}
              value={value.coordinatorId}
              onChange={(v) => onChange({ coordinatorId: v, page: 1 })}
              clearable
              searchable
              w={200}
            />
          )}
          <Autocomplete
            placeholder={t('dismissalsRegistry.filters.allReasons', { defaultValue: 'Wszystkie powody' })}
            data={reasonOptions}
            value={value.reasonCode ?? ''}
            onChange={(v) => onChange({ reasonCode: v || null, page: 1 })}
            w={220}
          />
          <TextInput
            placeholder={t('dismissalsRegistry.filters.reasonPlaceholder')}
            value={value.reason}
            onChange={(e) => onChange({ reason: e.currentTarget.value, page: 1 })}
            w={200}
          />
        </Group>
        <DateRangeFilter
          preset={value.preset}
          from={value.from}
          to={value.to}
          onChange={(next) =>
            onChange({ preset: next.preset, from: next.from, to: next.to, page: 1 })
          }
        />
      </Stack>
    </Paper>
  );
}
