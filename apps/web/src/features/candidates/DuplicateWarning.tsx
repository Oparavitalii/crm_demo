import { Alert, Badge, Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { DuplicateMatch } from '@opushr/shared';

interface Props {
  duplicates: DuplicateMatch[] | null;
  onCancel: () => void;
  onCreateAnyway: () => void;
}

export function DuplicateWarning({ duplicates, onCancel, onCreateAnyway }: Props) {
  const { t } = useTranslation('candidates');
  const navigate = useNavigate();
  if (!duplicates || duplicates.length === 0) return null;

  return (
    <Modal opened onClose={onCancel} title={t('duplicate.title')} size="lg" centered>
      <Stack>
        <Alert color="yellow" icon={<AlertTriangle size={18} />}>
          {t('duplicate.prompt')}
        </Alert>
        <List spacing="sm">
          {duplicates.map((d) => (
            <List.Item key={d.id}>
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={4}>
                  <Text fw={500}>
                    {d.name} — {d.email}
                  </Text>
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">{t('duplicate.matchedBy')}</Text>
                    {d.matchedBy.map((m) => (
                      <Badge key={m} size="xs" variant="light">
                        {t(`duplicate.match.${m}`)}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => navigate(`/candidates/${d.id}`)}
                >
                  {t('duplicate.viewExisting')}
                </Button>
              </Group>
            </List.Item>
          ))}
        </List>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
          <Button color="orange" onClick={onCreateAnyway}>
            {t('duplicate.createAnyway')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
