import { AppShell as MantineAppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PendingAcceptancesModal } from '@/features/documents/PendingAcceptancesModal';
import { useIsMobile } from '@/lib/use-is-mobile';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { MobileBottomNav } from './MobileBottomNav';

export function AppShellLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const isMobile = useIsMobile();
  const location = useLocation();
  useEffect(() => {
    if (opened) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);
  return (
    <MantineAppShell
      header={{ height: 56 }}
      navbar={{
        width: isMobile ? 280 : 240,
        breakpoint: 'md',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <MantineAppShell.Header>
        <AppHeader opened={opened} onToggle={toggle} />
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p={0}>
        <AppSidebar />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main pb={{ base: 72, sm: 0 }}>
        <PendingAcceptancesModal />
        <Outlet />
      </MantineAppShell.Main>
      {isMobile && <MobileBottomNav onOpenMenu={toggle} />}
    </MantineAppShell>
  );
}
