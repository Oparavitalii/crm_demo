import {
  Box,
  Button,
  Card,
  Container,
  CopyButton,
  Grid,
  Group,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  Building2,
  Copy,
  Home,
  Link as LinkIcon,
  Mail,
  Plus,
  ScrollText,
  ShieldCheck,
  UserMinus,
  Users,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { MyTasksWidget } from '@/features/tasks/MyTasksWidget';
import { MobileStatsStrip } from './MobileStatsStrip';

interface FeatureCardSpec {
  to: string;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
  roles?: Array<'admin' | 'recruiter' | 'coordinator' | 'readonly'>;
}

const FEATURE_CARDS: FeatureCardSpec[] = [
  { to: '/candidates',    titleKey: 'cards.candidates.title',    descKey: 'cards.candidates.desc',    icon: <Users size={28} /> },
  { to: '/communications',titleKey: 'cards.communications.title',descKey: 'cards.communications.desc',icon: <Mail size={28} /> },
  { to: '/accommodations',titleKey: 'cards.accommodations.title',descKey: 'cards.accommodations.desc',icon: <Home size={28} /> },
  { to: '/dismissals',    titleKey: 'cards.dismissals.title',    descKey: 'cards.dismissals.desc',    icon: <UserMinus size={28} />, roles: ['admin'] },
  { to: '/employer-inquiries', titleKey: 'cards.employers.title', descKey: 'cards.employers.desc', icon: <Building2 size={28} />, roles: ['admin'] },
  { to: '/admin/users',   titleKey: 'cards.admin.title',         descKey: 'cards.admin.desc',         icon: <ShieldCheck size={28} />, roles: ['admin'] },
  { to: '/admin/audit-log', titleKey: 'cards.audit.title',       descKey: 'cards.audit.desc',         icon: <ScrollText size={28} />, roles: ['admin'] },
];

function FeatureCard({ spec }: { spec: FeatureCardSpec }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();

  return (
    <Card
      withBorder
      radius="md"
      p="lg"
      style={{ cursor: 'pointer', height: '100%' }}
      onClick={() => navigate(spec.to)}
    >
      <Stack gap="md" h="100%" justify="space-between">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size={48} radius="md" variant="light" color="brand">
            {spec.icon}
          </ThemeIcon>
          <Title order={4}>{t(spec.titleKey)}</Title>
        </Group>
        <Text c="dimmed" size="sm">
          {t(spec.descKey)}
        </Text>
        <Button leftSection={<Plus size={16} />} variant="light" fullWidth>
          {t('cards.manage')}
        </Button>
      </Stack>
    </Card>
  );
}

function MyApplyLinkCard() {
  // 2026-06-13 — surface the user's personal /apply/:slug link prominently on
  // the dashboard so recruiters can grab it without digging into their
  // profile page. Same component-level guard as ProfilePage: only renders
  // when the user actually has a slug and is active.
  const { t } = useTranslation('auth');
  const user = useAuthStore((s) => s.user);
  if (!user?.publicSlug || !user.isActive) return null;
  const url = `${window.location.origin}/apply/${user.publicSlug}`;
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="xs">
        <Group gap="xs">
          <ThemeIcon size={28} radius="md" variant="light" color="brand">
            <LinkIcon size={16} />
          </ThemeIcon>
          <Title order={5}>{t('applyLink.title')}</Title>
        </Group>
        <Text size="xs" c="dimmed">{t('applyLink.hint')}</Text>
        <Group align="flex-end" gap="sm">
          <TextInput
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            miw={200}
            style={{ flex: 1 }}
          />
          <CopyButton value={url}>
            {({ copied, copy }) => (
              <Button variant="light" leftSection={<Copy size={16} />} onClick={copy}>
                {copied ? t('applyLink.copy') + ' ✓' : t('applyLink.copy')}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Card>
  );
}

export function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role);

  const visible = FEATURE_CARDS.filter((c) => !c.roles || (role && c.roles.includes(role)));

  return (
    <Container size="xl">
      <Stack gap="xl">
        <MobileStatsStrip />

        <MyApplyLinkCard />

        <MyTasksWidget />

        <Box visibleFrom="md">
          <Grid gutter="md">
            {visible.map((spec) => (
              <Grid.Col key={spec.to} span={{ base: 12, sm: 6, lg: 4, xl: 3 }}>
                <FeatureCard spec={spec} />
              </Grid.Col>
            ))}
          </Grid>
        </Box>
      </Stack>
    </Container>
  );
}
