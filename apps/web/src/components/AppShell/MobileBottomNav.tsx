import { Box, Text, UnstyledButton } from '@mantine/core';
import { LayoutDashboard, ListChecks, Mail, Menu, UserPlus } from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useHaptic } from '@/lib/use-haptic';

type IconType = ComponentType<{ size?: number | string }>;

interface TabDef {
  labelKey: string;
  to?: string;
  Icon: IconType;
  matchPrefix?: string;
}

const TABS: TabDef[] = [
  { labelKey: 'dashboard', to: '/', Icon: LayoutDashboard, matchPrefix: '/' },
  { labelKey: 'candidates', to: '/candidates', Icon: UserPlus, matchPrefix: '/candidates' },
  { labelKey: 'tasks', to: '/tasks', Icon: ListChecks, matchPrefix: '/tasks' },
  { labelKey: 'communications', to: '/communications', Icon: Mail, matchPrefix: '/communications' },
];

function isActive(pathname: string, prefix: string | undefined): boolean {
  if (!prefix) return false;
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function MobileBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation('nav');
  const { pathname } = useLocation();
  const haptic = useHaptic();

  return (
    <Box
      className="safe-area-pb"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        borderTop: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-body)',
        zIndex: 200,
      }}
    >
      {TABS.map(({ labelKey, to, Icon, matchPrefix }) => {
        const active = isActive(pathname, matchPrefix);
        return (
          <UnstyledButton
            key={labelKey}
            component={Link}
            to={to ?? '#'}
            onClick={() => {
              haptic.tap();
            }}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              color: active ? 'var(--mantine-color-brand-6)' : 'var(--mantine-color-dimmed)',
            }}
          >
            <Icon size={20} />
            <Text size="xs">{t(labelKey)}</Text>
          </UnstyledButton>
        );
      })}
      <UnstyledButton
        onClick={() => {
          haptic.tap();
          onOpenMenu();
        }}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          color: 'var(--mantine-color-dimmed)',
        }}
      >
        <Menu size={20} />
        <Text size="xs">{t('more')}</Text>
      </UnstyledButton>
    </Box>
  );
}
