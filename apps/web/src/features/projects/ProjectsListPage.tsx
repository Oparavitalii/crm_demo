import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { ArrowDown, ArrowUp, Edit, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth-store';
import { parseApiError } from '@/lib/http';
import { useProjects, useDeleteProject } from './api';
import { ProjectFormModal } from './ProjectFormModal';
import type { Project, ProjectSortDir, ProjectSortField } from '@opushr/shared';

function percentColor(p: number): string {
  if (p >= 0.8) return 'green';
  if (p >= 0.5) return 'orange';
  return 'red';
}

export function ProjectsListPage() {
  const { t } = useTranslation('projects');
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  // Sort + filter UI state. Defaults match the backend defaults
  // (sortBy='startDate', sortDir='desc') so the initial render reflects what
  // the API returns even before the user touches the controls.
  const [sortBy, setSortBy] = useState<ProjectSortField>('startDate');
  const [sortDir, setSortDir] = useState<ProjectSortDir>('desc');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const { data, isPending } = useProjects({
    pageSize: 500,
    sortBy,
    sortDir,
    q: search.trim() ? search.trim() : undefined,
    // When the toggle is OFF we explicitly request active=true. When ON we
    // omit the filter so both active and inactive rows come back.
    ...(showInactive ? {} : { isActive: true }),
  });
  const remove = useDeleteProject();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | undefined>(undefined);

  const items = data?.items ?? [];
  const sortOptions: Array<{ value: ProjectSortField; label: string }> = [
    { value: 'startDate', label: t('sort.startDate', { defaultValue: 'Дата старту' }) },
    { value: 'createdAt', label: t('sort.createdAt', { defaultValue: 'Дата створення' }) },
    { value: 'name', label: t('sort.name', { defaultValue: 'Назва (A-Z)' }) },
  ];

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }
  function openEdit(p: Project) {
    setEditing(p);
    setModalOpen(true);
  }
  function confirmDelete(p: Project) {
    modals.openConfirmModal({
      title: t('delete.confirm', { defaultValue: 'Usunąć projekt?' }),
      children: <Text size="sm">{p.name}</Text>,
      labels: {
        confirm: t('delete.button', { defaultValue: 'Usuń' }),
        cancel: t('form.cancel', { defaultValue: 'Anuluj' }),
      },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        remove.mutate(p.id, {
          onSuccess: () =>
            notifications.show({
              color: 'green',
              message: t('deleted', { defaultValue: 'Usunięto' }),
            }),
          onError: (err) => {
            const { code } = parseApiError(err);
            notifications.show({
              color: 'red',
              message:
                code === 'HAS_REFERENCES'
                  ? t('errors.hasReferences', {
                      defaultValue:
                        'Projekt jest używany — oznacz jako nieaktywny zamiast usuwania',
                    })
                  : t('errors.generic', { defaultValue: 'Błąd' }),
            });
          },
        });
      },
    });
  }

  return (
    <Container size="lg">
      <Stack>
        <Group justify="space-between">
          <Title order={2}>{t('list.title', { defaultValue: 'Projekty' })}</Title>
          {isAdmin && (
            <Button leftSection={<Plus size={16} />} onClick={openCreate}>
              {t('list.add', { defaultValue: 'Dodaj projekt' })}
            </Button>
          )}
        </Group>
        {/* Toolbar — search, "show inactive" toggle, sort field, sort direction.
            All controls feed back into the listProjectsQuery so the backend
            does the work (no client-side filtering). */}
        <Paper withBorder radius="md" p="sm" shadow="xs">
          <Group gap="sm" wrap="wrap">
            <TextInput
              placeholder={t('list.search', { defaultValue: 'Пошук за назвою…' })}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              w={240}
            />
            <Switch
              label={t('list.showInactive', { defaultValue: 'Показати неактивні' })}
              checked={showInactive}
              onChange={(e) => setShowInactive(e.currentTarget.checked)}
            />
            <Group gap={4} wrap="nowrap" ml="auto">
              <Text size="sm" c="dimmed">
                {t('list.sortBy', { defaultValue: 'Сортування:' })}
              </Text>
              <Select
                value={sortBy}
                onChange={(v) => v && setSortBy(v as ProjectSortField)}
                data={sortOptions}
                w={200}
                allowDeselect={false}
              />
              <Tooltip
                label={
                  sortDir === 'asc'
                    ? t('list.sortAsc', { defaultValue: 'За зростанням' })
                    : t('list.sortDesc', { defaultValue: 'За спаданням' })
                }
              >
                <ActionIcon
                  variant="default"
                  size="lg"
                  onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  aria-label="toggle-sort-dir"
                >
                  {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Paper>
        <Paper withBorder radius="md" p="md" shadow="xs">
          {isPending && <Text c="dimmed">…</Text>}
          {!isPending && items.length === 0 && (
            <Text c="dimmed">{t('list.empty', { defaultValue: 'Brak projektów' })}</Text>
          )}
          {items.length > 0 && (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('fields.name', { defaultValue: 'Nazwa' })}</Table.Th>
                  <Table.Th>{t('fields.isActive', { defaultValue: 'Aktywny' })}</Table.Th>
                  <Table.Th>{t('fields.startDate', { defaultValue: 'Data startu' })}</Table.Th>
                  <Table.Th>{t('fields.headcountNeeded', { defaultValue: 'Potrzebne' })}</Table.Th>
                  <Table.Th>{t('fields.foundCount', { defaultValue: 'Znaleziono' })}</Table.Th>
                  <Table.Th>{t('fields.missingCount', { defaultValue: 'Brakuje' })}</Table.Th>
                  <Table.Th>{t('fields.percentFilled', { defaultValue: '%' })}</Table.Th>
                  <Table.Th>{t('fields.createdAt', { defaultValue: 'Utworzono' })}</Table.Th>
                  <Table.Th>{t('fields.notes', { defaultValue: 'Notatki' })}</Table.Th>
                  {isAdmin && (
                    <Table.Th style={{ width: 110 }}>
                      {t('actions', { defaultValue: 'Akcje' })}
                    </Table.Th>
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((p) => {
                  const pct = p.percentFilled ?? 0;
                  const resetDate = p.headcountResetAt
                    ? new Date(p.headcountResetAt).toISOString().slice(0, 10)
                    : null;
                  const tooltipLabel = resetDate
                    ? t('tooltips.countingFrom', {
                        defaultValue: 'Liczone od {{date}}',
                        date: resetDate,
                      })
                    : null;
                  const foundValue = <span>{p.foundCount ?? 0}</span>;
                  return (
                    <Table.Tr key={p.id}>
                      <Table.Td>{p.name}</Table.Td>
                      <Table.Td>
                        <Badge color={p.isActive ? 'green' : 'gray'} variant="light">
                          {p.isActive
                            ? t('badge.active', { defaultValue: 'aktywny' })
                            : t('badge.inactive', { defaultValue: 'nieaktywny' })}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {p.startDate ? new Date(p.startDate).toLocaleDateString() : '—'}
                      </Table.Td>
                      <Table.Td>{p.startDate ? p.headcountNeeded : '—'}</Table.Td>
                      <Table.Td title={tooltipLabel ?? undefined}>
                        {tooltipLabel ? (
                          <Tooltip label={tooltipLabel} withArrow>
                            {foundValue}
                          </Tooltip>
                        ) : (
                          foundValue
                        )}
                      </Table.Td>
                      <Table.Td>{p.startDate ? (p.missingCount ?? 0) : '—'}</Table.Td>
                      <Table.Td>
                        {p.startDate ? (
                          <Badge color={percentColor(pct)} variant="light">
                            {`${Math.round(pct * 100)}%`}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>{new Date(p.createdAt).toLocaleDateString()}</Table.Td>
                      <Table.Td style={{ maxWidth: 320 }}>
                        {p.notes ? (
                          <Text size="sm" lineClamp={2} title={p.notes}>
                            {p.notes}
                          </Text>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      {isAdmin && (
                        <Table.Td>
                          <Group gap="xs">
                            <ActionIcon
                              variant="subtle"
                              onClick={() => openEdit(p)}
                              aria-label="edit"
                            >
                              <Edit size={16} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => confirmDelete(p)}
                              aria-label="delete"
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      </Stack>
      <ProjectFormModal
        key={editing?.id ?? 'new'}
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
      />
    </Container>
  );
}
