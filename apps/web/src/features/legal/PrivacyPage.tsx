import { Anchor, Container, Divider, Paper, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

// Single-page privacy notice. Content is driven entirely by i18n so adding a
// new sub-processor or retention window is a JSON edit, not a code change.
// Sections mirror the RODO checklist in docs/Engineering_Rules.md §4 — keep the two in
// sync when either changes.
const SECTIONS = [
  'controller',
  'purposes',
  'categories',
  'retention',
  'rights',
  'subprocessors',
  'transfers',
  'complaint',
] as const;

export function PrivacyPage() {
  const { t } = useTranslation('auth');

  return (
    <Container size={720} py={60}>
      <Stack gap="xs" mb="lg">
        <Title order={2}>{t('privacy.title')}</Title>
        <Text size="xs" c="dimmed">
          {t('privacy.lastUpdated')}
        </Text>
      </Stack>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="lg">
          {SECTIONS.map((s, i) => (
            <Stack key={s} gap="xs">
              {i > 0 && <Divider mb="xs" />}
              <Title order={4}>{t(`privacy.${s}Title`)}</Title>
              <Text size="sm">{t(`privacy.${s}Body`)}</Text>
            </Stack>
          ))}
        </Stack>
      </Paper>
      <Anchor component={Link} to="/login" size="sm" display="block" ta="center" mt="lg">
        {t('withdraw.backToLogin')}
      </Anchor>
    </Container>
  );
}
