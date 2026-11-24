import { Alert, Container, Grid, Skeleton, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ProfileStatsView } from './ProfileStatsView';
import { useUserStats } from './api';

// Per-user analytics page. Mounted at /analytics/users/:userId — this lives
// under /analytics because that's where recruiters and admins naturally look
// for KPI drill-downs. The file still sits under features/admin-users for
// proximity to the user fetch hooks; folder vs URL mismatch is intentional.
// Authorization is enforced on the backend (admin OR self) — the route guard
// here uses ProtectedRoute without a roles list so recruiters/coordinators
// can land on their own page; the API returns 403 for mismatched IDs.

export function UserStatsPage() {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useTranslation('admin');
  const { data, isPending, isError, error } = useUserStats(userId);

  if (isPending) {
    return (
      <Container size="lg">
        <Stack>
          <Skeleton height={32} width={240} />
          <Grid>
            {[0, 1, 2, 3].map((i) => (
              <Grid.Col key={i} span={{ base: 12, sm: 6, md: 3 }}>
                <Skeleton height={120} radius="md" />
              </Grid.Col>
            ))}
          </Grid>
          <Skeleton height={300} radius="md" />
        </Stack>
      </Container>
    );
  }
  if (isError || !data) {
    const code = (error as { data?: { error?: string } } | null)?.data?.error;
    return (
      <Container size="lg">
        <Alert color="red" title={t('users.errors.generic')}>
          {code === 'FORBIDDEN'
            ? t('users.errors.forbidden')
            : code === 'NOT_FOUND'
              ? t('users.errors.notFound')
              : t('users.errors.generic')}
        </Alert>
      </Container>
    );
  }
  return (
    <ProfileStatsView
      stats={data}
      backHref="/admin/users"
      backLabel={t('users.list.title')}
    />
  );
}
