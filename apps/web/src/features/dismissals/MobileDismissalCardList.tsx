import type { JSX } from 'react';
import { Badge, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { EnrichedDismissal } from '@crm/shared';

interface Props {
  items: EnrichedDismissal[];
  isLoading: boolean;
}

export function MobileDismissalCardList(props: Props): JSX.Element {
  const { items, isLoading } = props;
  const { t } = useTranslation('operations');
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Stack gap="sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} h={72} radius="md" />
        ))}
      </Stack>
    );
  }

  if (items.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        {t('dismissalsRegistry.empty')}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {items.map((d) => {
        const candidateName = d.candidateName ?? '—';
        const reason = d.reasonCode || d.reason || '';
        return (
          <UnstyledButton
            key={d.id}
            onClick={() => navigate(`/candidates/${d.candidateId}`)}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <Paper withBorder radius="md" p="sm">
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Text fw={600} size="sm" truncate>
                    {candidateName}
                  </Text>
                  <Badge size="sm" variant="light">
                    {new Date(d.dismissedAt).toLocaleDateString()}
                  </Badge>
                </Group>
                {reason && (
                  <Text size="xs" c="dimmed" truncate>
                    {reason}
                  </Text>
                )}
              </Stack>
            </Paper>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
