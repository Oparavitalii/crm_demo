import type { JSX } from 'react';
import { Badge, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { HousingCandidate } from '@opushr/shared';
import { STATUS_COLORS } from '@/features/candidates/columns';

interface Props {
  items: HousingCandidate[];
  isLoading: boolean;
}

export function MobileAccommodationCardList(props: Props): JSX.Element {
  const { items, isLoading } = props;
  const { t } = useTranslation(['operations', 'candidates']);
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
        {t('operations:housing.empty')}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {items.map((c) => (
        <UnstyledButton
          key={c.id}
          onClick={() => navigate(`/candidates/${c.id}`)}
          style={{ width: '100%', textAlign: 'left' }}
        >
          <Paper withBorder radius="md" p="sm">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text fw={600} size="sm" truncate>
                  {c.name}
                </Text>
                <Badge size="sm" variant="light" color={STATUS_COLORS[c.status]}>
                  {t(`candidates:status.${c.status}`)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" truncate>
                {t('operations:housing.tableUpdatedAt')}: {new Date(c.updatedAt).toLocaleDateString()}
              </Text>
            </Stack>
          </Paper>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
