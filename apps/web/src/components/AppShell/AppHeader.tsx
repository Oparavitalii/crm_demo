import {
  Group,
  Burger,
  Title,
  Text,
  Button,
  Menu,
  Avatar,
  ActionIcon,
  Box,
  useMantineColorScheme,
} from '@mantine/core';
import { Sun, Moon, User as UserIcon, Settings, LogOut, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/api';
import { LangSwitcher } from '@/components/LangSwitcher';

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <ActionIcon
      variant="subtle"
      size="lg"
      onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle color scheme"
    >
      {colorScheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </ActionIcon>
  );
}

export function AppHeader({ opened, onToggle }: { opened: boolean; onToggle: () => void }) {
  const { t } = useTranslation('common');
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();

  const initials = user
    ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
    : '?';

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm">
        <Burger opened={opened} onClick={onToggle} hiddenFrom="md" size="sm" />
        <Title order={4}>{t('app.title')}</Title>
      </Group>
      <Group gap="xs">
        <Box visibleFrom="md">
          <LangSwitcher />
        </Box>
        <ColorSchemeToggle />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button variant="subtle" leftSection={<Avatar size="sm" color="brand">{initials}</Avatar>}>
              <Box visibleFrom="md" component="span">
                {user ? `${user.firstName} ${user.lastName}` : '...'}
              </Box>
              {user && (
                <Box visibleFrom="md" component="span">
                  <Text component="span" c="dimmed" ml={6} size="xs">
                    {user.role}
                  </Text>
                </Box>
              )}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<UserIcon size={14} />} disabled>
              {user?.email}
            </Menu.Item>
            {user && (user.role === 'recruiter' || user.role === 'coordinator') && (
              <Menu.Item
                leftSection={<BarChart3 size={14} />}
                component={Link}
                to={`/analytics/users/${user.id}`}
              >
                {t('actions.myStats')}
              </Menu.Item>
            )}
            <Menu.Item leftSection={<Settings size={14} />} component={Link} to="/profile">
              {t('actions.profile')}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<LogOut size={14} />}
              color="red"
              onClick={() => {
                logout.mutate(undefined, {
                  onSuccess: () => navigate('/login'),
                });
              }}
            >
              {t('actions.logout')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
