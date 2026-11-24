import { Grid, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight, ListChecks, TrendingUp, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { useTasks } from '@/features/tasks/api';
import { useDashboard } from './api';

// Glanceable KPI strip rendered ABOVE the launchpad hero. On <sm it's a 2x2
// grid; on >=sm it's a 4-up row of small tiles. Reuses existing dashboard +
// tasks queries — no new API calls. Each tile is tappable and drills into the
// relevant filtered list.

interface TileSpec {
  label: string;
  value: string;
  icon: React.ReactNode;
  href: string;
}

function StatTile({ spec, onClick }: { spec: TileSpec; onClick: () => void }) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <Paper withBorder p="sm" radius="md">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap" gap={4}>
            <Text fz={24} fw={700} lh={1}>
              {spec.value}
            </Text>
            <Group gap={2} wrap="nowrap" c="dimmed">
              {spec.icon}
              <ChevronRight size={14} color="gray" />
            </Group>
          </Group>
          <Text size="xs" c="dimmed" tt="uppercase" lts={0.3}>
            {spec.label}
          </Text>
        </Stack>
      </Paper>
    </UnstyledButton>
  );
}

function SkeletonTile() {
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap={6}>
        <Skeleton h={28} />
        <Skeleton h={10} w="60%" />
      </Stack>
    </Paper>
  );
}

export function MobileStatsStrip() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data: dashboard, isPending: dashboardPending } = useDashboard({
    preset: 'all',
  });
  const { data: tasks, isPending: tasksPending } = useTasks({
    assigneeId: user?.id,
    state: 'open',
    pageSize: 1,
  });

  const isLoading = dashboardPending || tasksPending;

  if (isLoading || !dashboard) {
    return (
      <Grid gutter="xs">
        {[0, 1, 2, 3].map((i) => (
          <Grid.Col key={i} span={{ base: 6, sm: 3 }}>
            <SkeletonTile />
          </Grid.Col>
        ))}
      </Grid>
    );
  }

  const myTasksTotal = tasks?.total ?? tasks?.items.length ?? 0;
  const kpi = dashboard.kpi;

  const tiles: TileSpec[] = [
    {
      label: t('kpi.candidatesThisWeek'),
      value: String(kpi.candidatesThisWeek),
      icon: <UserPlus size={14} />,
      href: '/candidates?preset=7d',
    },
    {
      label: t('kpi.totalCandidates'),
      value: String(kpi.totalCandidates),
      icon: <Users size={14} />,
      href: '/candidates',
    },
    {
      label: t('kpi.openTasks'),
      value: String(myTasksTotal),
      icon: <ListChecks size={14} />,
      href: '/tasks?state=open',
    },
    {
      label: t('kpi.conversionRate'),
      value: `${(kpi.conversionRate * 100).toFixed(0)}%`,
      icon: <TrendingUp size={14} />,
      href: '/analytics',
    },
  ];

  return (
    <Grid gutter="xs">
      {tiles.map((spec) => (
        <Grid.Col key={spec.label} span={{ base: 6, sm: 3 }}>
          <StatTile spec={spec} onClick={() => navigate(spec.href)} />
        </Grid.Col>
      ))}
    </Grid>
  );
}
