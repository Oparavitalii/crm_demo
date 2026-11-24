import { useMemo } from 'react';
import {
  Center,
  Grid,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Users, Home, Building2, ShieldCheck, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseAsString, useQueryStates } from 'nuqs';
import { useAuthStore } from '@/lib/auth-store';
import { useIsMobile } from '@/lib/use-is-mobile';
import type { DashboardFilters, DashboardRange } from '@crm/shared';
import { useDashboard } from './api';
import { KpiTile } from './KpiTile';
import { StatusFunnel } from './StatusFunnel';
import { SourceBreakdown } from './SourceBreakdown';
import { RecruiterKpiTable } from './RecruiterKpiTable';
import { CoordinatorKpiTable } from './CoordinatorKpiTable';
import { WeeklyTrend } from './WeeklyTrend';
import { PeriodStats } from './PeriodStats';
import { RetentionCategoryTable } from './RetentionCategoryTable';
import { EmployerStatsPanel } from './EmployerStatsPanel';

const PRESETS: DashboardRange[] = [
  'today',
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
  'quarter',
  'all',
  'custom',
];

export function AnalyticsPage() {
  const { t } = useTranslation('dashboard');
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();

  const [{ preset, from, to, tab }, setUrl] = useQueryStates({
    preset: parseAsString.withDefault('all'),
    from: parseAsString,
    to: parseAsString,
    tab: parseAsString.withDefault('candidates'),
  });

  // Build filters object. When preset='custom' but dates not yet picked, fall back
  // to 'all' so the backend never gets an invalid request (Zod refine would 400).
  // The SegmentedControl stays on 'custom' and the DatePickerInput renders — user
  // sees all-time data until they pick a range, then the panels refresh.
  const filters: DashboardFilters = useMemo(() => {
    if (preset === 'custom' && from && to) {
      return { preset: 'custom', from, to };
    }
    if (preset === 'custom') {
      return { preset: 'all' };
    }
    return { preset: (preset as DashboardRange) || 'all' };
  }, [preset, from, to]);

  const { data, isPending } = useDashboard(filters);

  if (isPending) {
    return (
      <Center mih="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (!data) {
    return (
      <Stack align="center" gap="md" mt="xl">
        <Title order={2}>{t('empty.title')}</Title>
        <Text c="dimmed">{t('empty.prompt')}</Text>
      </Stack>
    );
  }

  const presetOptions = PRESETS.map((p) => ({ value: p, label: t(`range.${p}`) }));

  const isAdmin = user?.role === 'admin';
  const conversionPct = `${(data.kpi.conversionRate * 100).toFixed(1)}%`;

  // Parse custom range for DatePickerInput. nuqs gives strings, picker wants [Date|null, Date|null].
  const rangeValue: [Date | null, Date | null] = [
    from ? new Date(from) : null,
    to ? new Date(to) : null,
  ];

  return (
    <Stack gap={isMobile ? 'md' : 'xl'} px={isMobile ? 0 : undefined}>
      <Stack gap={isMobile ? 'xs' : 'sm'}>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Title order={isMobile ? 3 : 2} mb={isMobile ? 0 : undefined}>
            {t('title')}
          </Title>
          <Stack gap="xs" align="flex-end">
            <SegmentedControl
              value={preset || 'all'}
              onChange={(v) =>
                setUrl(
                  v === 'custom'
                    ? { preset: 'custom' }
                    : { preset: v, from: null, to: null },
                )
              }
              data={presetOptions}
              size="sm"
            />
            {preset === 'custom' && (
              <DatePickerInput
                type="range"
                value={rangeValue}
                onChange={([f, t2]) =>
                  setUrl({
                    from: f ? f.toISOString() : null,
                    to: t2 ? t2.toISOString() : null,
                  })
                }
                placeholder={t('range.customPlaceholder')}
                miw={280}
                clearable
                size="sm"
              />
            )}
          </Stack>
        </Group>
      </Stack>

      <Tabs value={tab} onChange={(v) => setUrl({ tab: v ?? 'candidates' })}>
        <Tabs.List>
          <Tabs.Tab value="candidates" leftSection={<Users size={16} />}>
            {t('tabs.candidates')}
          </Tabs.Tab>
          <Tabs.Tab value="living" leftSection={<Home size={16} />}>
            {t('tabs.living')}
          </Tabs.Tab>
          {isAdmin && (
            <Tabs.Tab value="employers" leftSection={<Building2 size={16} />}>
              {t('tabs.employers')}
            </Tabs.Tab>
          )}
          {isAdmin && (
            <Tabs.Tab value="admin" leftSection={<ShieldCheck size={16} />}>
              {t('tabs.admin')}
            </Tabs.Tab>
          )}
          {isAdmin && (
            <Tabs.Tab value="coordinators" leftSection={<UserCog size={16} />}>
              {t('tabs.coordinators')}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="candidates" pt="lg">
          <Stack gap="xl">
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                <KpiTile title={t('kpi.totalCandidates')} value={data.kpi.totalCandidates} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                <KpiTile title={t('kpi.candidatesThisWeek')} value={data.kpi.candidatesThisWeek} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                <KpiTile title={t('kpi.conversionRate')} value={conversionPct} />
              </Grid.Col>
            </Grid>

            <Grid>
              <Grid.Col span={{ base: 12, md: 7 }}>
                <StatusFunnel data={data.statusFunnel} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <SourceBreakdown data={data.sourceBreakdown} />
              </Grid.Col>
            </Grid>

            <WeeklyTrend data={data.weeklyTrend} />
            <PeriodStats data={data.periodStats} />
            <RetentionCategoryTable
              title={t('retentionType.title')}
              hint={t('retentionType.hint')}
              data={data.retentionByRecruiterType}
              categoryLabel={(k) => t(`retentionType.cat.${k}`)}
            />
            <RetentionCategoryTable
              title={t('retentionChan.title')}
              hint={t('retentionChan.hint')}
              data={data.retentionByChannel}
              categoryLabel={(k) => t(`retentionChan.cat.${k}`)}
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="living" pt="lg">
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <KpiTile
                title={t('housing.ourHousing')}
                value={data.housingStats.ourHousingCount}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <KpiTile
                title={t('housing.ownHousing')}
                value={data.housingStats.ownHousingCount}
              />
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        {isAdmin && (
          <Tabs.Panel value="employers" pt="lg">
            <EmployerStatsPanel data={data.employerStats} />
          </Tabs.Panel>
        )}

        {isAdmin && (
          <Tabs.Panel value="admin" pt="lg">
            <RecruiterKpiTable
              recruiters={data.recruiterKpi}
              freelancers={data.freelancerKpi}
            />
          </Tabs.Panel>
        )}

        {isAdmin && (
          <Tabs.Panel value="coordinators" pt="lg">
            <CoordinatorKpiTable coordinators={data.coordinatorKpi} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
