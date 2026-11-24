import { useState } from 'react';
import {
  Badge,
  Button,
  Center,
  Container,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { HousingCandidate, HousingGroup } from '@opushr/shared';
import { STATUS_COLORS } from '@/features/candidates/columns';
import { useHousingSummary } from './api';
import { MobileAccommodationCardList } from './MobileAccommodationCardList';
import { useIsMobile } from '@/lib/use-is-mobile';

const PAGE_SIZE = 10;

type GroupKey = 'our' | 'own';

function GroupTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick} style={{ width: '100%' }}>
      <Paper
        withBorder
        p="lg"
        radius="md"
        shadow={active ? 'md' : 'sm'}
        data-reveal
        style={{
          borderColor: active ? 'var(--mantine-color-blue-6)' : undefined,
          borderWidth: active ? 2 : 1,
          transition: 'all 0.15s ease',
        }}
      >
        <Stack gap={4}>
          <Text c={active ? 'blue' : 'dimmed'} size="sm" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Title order={1} style={{ fontSize: '3rem', lineHeight: 1 }}>
            {value}
          </Title>
        </Stack>
      </Paper>
    </UnstyledButton>
  );
}

function HousingTable({ candidates }: { candidates: HousingCandidate[] }) {
  const { t } = useTranslation(['operations', 'candidates']);
  const navigate = useNavigate();

  if (candidates.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t('operations:housing.empty')}
      </Text>
    );
  }

  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('operations:housing.tableName')}</Table.Th>
          <Table.Th>{t('operations:housing.tableStatus')}</Table.Th>
          <Table.Th>{t('operations:housing.tableUpdatedAt')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {candidates.map((c) => (
          <Table.Tr
            key={c.id}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/candidates/${c.id}`)}
          >
            <Table.Td>
              <Text fw={500}>
                {c.name}
              </Text>
            </Table.Td>
            <Table.Td>
              <Badge
                color={STATUS_COLORS[c.status]}
                variant="light"
                style={{ whiteSpace: 'nowrap' }}
              >
                {t(`candidates:status.${c.status}`)}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                {new Date(c.updatedAt).toLocaleDateString()}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function AccommodationListPage() {
  const { t } = useTranslation('operations');
  const { data, isPending } = useHousingSummary();
  const [active, setActive] = useState<GroupKey>('our');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const isMobile = useIsMobile();

  if (isPending || !data) {
    return (
      <Center mih="40vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const activeGroup: HousingGroup = active === 'our' ? data.ourHousing : data.ownHousing;
  const shown = activeGroup.candidates.slice(0, visible);
  const hasMore = visible < activeGroup.candidates.length;

  const switchGroup = (key: GroupKey) => {
    setActive(key);
    setVisible(PAGE_SIZE);
  };

  return (
    <Container size="xl">
      <Group justify="space-between" mb="md" data-reveal>
        <Title order={2}>{t('housing.title')}</Title>
      </Group>

      <Grid mb="xl">
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <GroupTile
            label={t('housing.ourHousing')}
            value={data.ourHousing.count}
            active={active === 'our'}
            onClick={() => switchGroup('our')}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <GroupTile
            label={t('housing.ownHousing')}
            value={data.ownHousing.count}
            active={active === 'own'}
            onClick={() => switchGroup('own')}
          />
        </Grid.Col>
      </Grid>

      <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={4}>
              {active === 'our' ? t('housing.ourHousing') : t('housing.ownHousing')}
            </Title>
            <Text size="sm" c="dimmed">
              {t('housing.showing', {
                count: shown.length,
                total: activeGroup.candidates.length,
              })}
            </Text>
          </Group>

          {isMobile ? (
            <MobileAccommodationCardList items={shown} isLoading={false} />
          ) : (
            <HousingTable candidates={shown} />
          )}

          {hasMore && (
            <Group justify="center">
              <Button
                variant="light"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
              >
                {t('housing.showMore')}
              </Button>
            </Group>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
