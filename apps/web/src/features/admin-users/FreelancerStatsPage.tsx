import { Alert, Container, Grid, Skeleton, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ProfileStatsView } from './ProfileStatsView';
import { useFreelancerStats } from './api';

// External-freelancer analytics drill-down at /analytics/freelancers/:id.
// Same look as UserStatsPage but pulls data from the freelancers endpoint.
// Lives under features/admin-users for proximity to ProfileStatsView and the
// stats hooks; URL is /analytics because that's where the recruiter KPI
// table's Stats button leads.

export function FreelancerStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('admin');
  const { data, isPending, isError, error } = useFreelancerStats(id);

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
      backHref="/analytics?tab=admin"
      backLabel={t('users.list.title')}
    />
  );
}
