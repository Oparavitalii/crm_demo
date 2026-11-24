import { ActionIcon, Avatar, Box, Button, Collapse, Group, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  BarChart3,
  Users,
  UsersRound,
  UserPlus,
  Mail,
  Briefcase,
  Building2,
  Home,
  UserMinus,
  UserX,
  ShieldCheck,
  ScrollText,
  LogOut,
  FileText,
  Pin,
  Circle,
  ChevronRight,
  ListChecks,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/api';

type Role = 'admin' | 'recruiter' | 'coordinator' | 'readonly';

interface Item {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
  roles?: Role[];
  // Nested entries — rendered inside the parent NavLink as collapsible
  // sub-items. Used for the candidates-by-source breakdown so recruiters can
  // jump straight to a single channel without typing into the source filter.
  children?: Item[];
}

interface NavGroup {
  key: string;
  items: Item[];
}

const SUB_ICON = <Circle size={6} fill="currentColor" />;

const GROUPS: NavGroup[] = [
  {
    key: 'main',
    items: [
      { to: '/', labelKey: 'dashboard', icon: <LayoutDashboard size={18} /> },
      {
        to: '/analytics',
        labelKey: 'analytics',
        icon: <BarChart3 size={18} />,
        children: [
          { to: '/analytics?tab=candidates', labelKey: 'analyticsTabs.candidates', icon: SUB_ICON },
          { to: '/analytics?tab=living',     labelKey: 'analyticsTabs.living',     icon: SUB_ICON },
          { to: '/analytics?tab=vacancies',  labelKey: 'analyticsTabs.vacancies',  icon: SUB_ICON },
          { to: '/analytics?tab=employers',  labelKey: 'analyticsTabs.employers',  icon: SUB_ICON, roles: ['admin'] },
          { to: '/analytics?tab=admin',      labelKey: 'analyticsTabs.admin',      icon: SUB_ICON, roles: ['admin'] },
        ],
      },
      { to: '/tasks', labelKey: 'tasks', icon: <ListChecks size={18} /> },
      { to: '/communications', labelKey: 'communications', icon: <Mail size={18} /> },
    ],
  },
  {
    key: 'acquisition',
    items: [
      // "Всі" — combined roster (candidates + clients, no status-bucket filter).
      { to: '/people', labelKey: 'allPeople', icon: <UsersRound size={18} /> },
      { to: '/clients', labelKey: 'clients', icon: <Users size={18} /> },
      {
        to: '/candidates',
        labelKey: 'candidates',
        icon: <UserPlus size={18} />,
        children: [
          { to: '/candidates?source=facebook',  labelKey: 'sources.facebook',  icon: SUB_ICON },
          { to: '/candidates?source=instagram', labelKey: 'sources.instagram', icon: SUB_ICON },
          { to: '/candidates?source=website',   labelKey: 'sources.website',   icon: SUB_ICON },
          { to: '/candidates?source=work_ua',   labelKey: 'sources.work_ua',   icon: SUB_ICON },
          { to: '/candidates?source=flagma',    labelKey: 'sources.flagma',    icon: SUB_ICON },
          { to: '/candidates?source=referral',  labelKey: 'sources.referral',  icon: SUB_ICON },
          { to: '/candidates?source=unknown',   labelKey: 'sources.unknown',   icon: SUB_ICON },
        ],
      },
    ],
  },
  {
    key: 'operations',
    items: [
      { to: '/employer-inquiries', labelKey: 'employerInquiries', icon: <Building2 size={18} />, roles: ['admin'] },
      { to: '/projects', labelKey: 'projects', icon: <Briefcase size={18} /> },
      { to: '/accommodations', labelKey: 'accommodations', icon: <Home size={18} /> },
      { to: '/dismissals', labelKey: 'dismissalsRegistry', icon: <UserMinus size={18} />, roles: ['admin'] },
      { to: '/failed-candidates', labelKey: 'failedCandidates', icon: <UserX size={18} /> },
    ],
  },
  {
    key: 'documents',
    items: [
      { to: '/documents', labelKey: 'documents', icon: <FileText size={18} /> },
      {
        to: '/admin/documents',
        labelKey: 'adminDocuments',
        icon: <FileText size={18} />,
        roles: ['admin'],
      },
    ],
  },
  {
    key: 'administration',
    items: [
      { to: '/admin', labelKey: 'adminUsers', icon: <ShieldCheck size={18} />, roles: ['admin'] },
      { to: '/admin/settings/statuses', labelKey: 'settingsStatuses', icon: <Settings size={18} />, roles: ['admin'] },
      { to: '/admin/audit-log', labelKey: 'auditLog', icon: <ScrollText size={18} />, roles: ['admin'] },
    ],
  },
];

const STORAGE_KEY = 'crm.sidebar.pinned.v1';

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function savePinned(arr: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage quota / disabled — silently ignore
  }
}

export function AppSidebar() {
  const { t } = useTranslation(['nav', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const logout = useLogout();
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  // Controlled open state for parent NavLinks that have children. Submenu is
  // collapsed by default so the parent click reliably navigates to the "all"
  // view; the explicit chevron button is the only way to toggle.
  const [openParents, setOpenParents] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    savePinned(pinned);
  }, [pinned]);

  const togglePin = (to: string) => {
    setPinned((prev) => (prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to]));
  };

  const toggleOpen = (to: string) => {
    setOpenParents((prev) => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      return next;
    });
  };

  const isVisible = (item: Item) => !item.roles || (role !== undefined && item.roles.includes(role));
  // Flatten parents AND children so pinning a /candidates?source=facebook child works.
  const flatten = (items: Item[]): Item[] =>
    items.flatMap((i) => (i.children ? [i, ...i.children] : [i]));
  const allVisibleItems = flatten(GROUPS.flatMap((g) => g.items)).filter(isVisible);
  const pinnedItems = pinned
    .map((to) => allVisibleItems.find((i) => i.to === to))
    .filter((i): i is Item => i !== undefined);

  // Active-state for items where multiple share the same pathname but differ
  // by query string (e.g. /candidates vs /candidates?source=facebook).
  // RouterNavLink only matches on path so we override Mantine's active prop here.
  const currentSearch = new URLSearchParams(location.search);
  const computeActive = (item: Item): boolean | undefined => {
    const [path, query] = item.to.split('?');
    if (location.pathname !== path) return undefined;
    if (!query) {
      // No-query parent: don't highlight when the URL points at one of its
      // children (otherwise both parent and child light up at once).
      if (path === '/candidates') return !currentSearch.get('source');
      if (path === '/analytics') {
        const t = currentSearch.get('tab');
        return !t || t === 'candidates';
      }
      return undefined;
    }
    const itemSearch = new URLSearchParams(query);
    for (const [k, v] of itemSearch) {
      if (currentSearch.get(k) !== v) return false;
    }
    return true;
  };

  // keyPrefix scopes React keys per section. Same item (e.g. /candidates and its
  // facebook child) can appear in both "Przypięte" and "Pozyskiwanie" — without a
  // prefix, React sees duplicate keys and warns / mis-reconciles state.
  const renderItem = (item: Item, keyPrefix = ''): React.ReactNode => {
    const reactKey = `${keyPrefix}${item.to}`;
    const isPinned = pinned.includes(item.to);
    const active = computeActive(item);
    const hasChildren = item.children !== undefined;
    const isOpen = openParents.has(item.to);
    const link = (
      <NavLink
        key={reactKey}
        component={RouterNavLink}
        to={item.to}
        end={item.to === '/'}
        label={t(`nav:${item.labelKey}`)}
        leftSection={item.icon}
        {...(active !== undefined ? { active } : {})}
        rightSection={
          <Group gap={4} wrap="nowrap">
            {hasChildren && (
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={t(isOpen ? 'nav:collapseAction' : 'nav:expandAction')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleOpen(item.to);
                }}
              >
                <ChevronRight
                  size={14}
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
                />
              </ActionIcon>
            )}
            <Tooltip label={t(isPinned ? 'nav:unpinAction' : 'nav:pinAction')} position="right" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                color={isPinned ? 'brand' : 'gray'}
                aria-label={t(isPinned ? 'nav:unpinAction' : 'nav:pinAction')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin(item.to);
                }}
              >
                <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
      />
    );
    if (!hasChildren) return link;
    // Render children OUTSIDE NavLink so the parent <a> stays a plain link —
    // Mantine NavLink with nested children intercepts click for the collapse
    // toggle and breaks navigation via RouterNavLink.
    return (
      <Box key={reactKey}>
        {link}
        <Collapse in={isOpen}>
          <Box pl={28}>
            {item.children?.filter(isVisible).map((child) => renderItem(child, keyPrefix))}
          </Box>
        </Collapse>
      </Box>
    );
  };

  return (
    <Stack h="100%" justify="space-between" gap={0}>
      <ScrollArea style={{ flex: 1 }} scrollbarSize={8} type="hover">
        <Stack gap="xs">
          <Box px="sm" pt="sm" pb="md">
            <Avatar color="brand" radius="sm" size="md">
              <Briefcase size={20} />
            </Avatar>
            <Text size="lg" fw={700} mt="xs" c="brand">
              CRM Demo
            </Text>
            <Text size="xs" c="dimmed">
              Panel Administracyjny
            </Text>
          </Box>
          <Box>
            {pinnedItems.length > 0 && (
              <NavLink
                label={t('nav:groups.pinned')}
                leftSection={<Pin size={14} fill="currentColor" />}
                defaultOpened
                childrenOffset={24}
              >
                {pinnedItems.map((item) => renderItem(item, 'pinned:'))}
              </NavLink>
            )}
            {GROUPS.map((group) => {
              const visible = group.items.filter(isVisible);
              if (visible.length === 0) return null;
              return (
                <NavLink
                  key={group.key}
                  label={t(`nav:groups.${group.key}`)}
                  defaultOpened
                  childrenOffset={24}
                >
                  {visible.map((item) => renderItem(item, `${group.key}:`))}
                </NavLink>
              );
            })}
          </Box>
        </Stack>
      </ScrollArea>
      <Box px="sm" py="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Button
          color="red"
          variant="light"
          fullWidth
          leftSection={<LogOut size={16} />}
          onClick={() => {
            logout.mutate(undefined, {
              onSuccess: () => navigate('/login'),
            });
          }}
        >
          {t('common:actions.logout')}
        </Button>
      </Box>
    </Stack>
  );
}
