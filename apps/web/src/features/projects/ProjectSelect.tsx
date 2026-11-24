import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, TextInput } from '@mantine/core';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth-store';
import { useCreateProject, useProjects } from './api';

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}

// Reusable Select with inline "+ new" option (admin-only). Used on candidate
// and vacancy forms so recruiters pick from the seeded 7 projects but admins
// can add custom ones without leaving the page.
export function ProjectSelect({
  value,
  onChange,
  label,
  placeholder,
  required,
  error,
  disabled,
}: Props) {
  const { t } = useTranslation('candidates');
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const { data } = useProjects({ isActive: true, pageSize: 500 });
  const create = useCreateProject();
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const items = (data?.items ?? []).map((p) => ({ value: p.id, label: p.name }));

  async function handleCreate() {
    setCreateError(null);
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await create.mutateAsync({ name, isActive: true, headcountNeeded: 0 });
      onChange(created.id);
      setNewName('');
      setModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      setCreateError(msg);
    }
  }

  return (
    <>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Select
          flex={1}
          label={label ?? t('fields.project')}
          placeholder={placeholder ?? t('list.filters.allProjects')}
          data={items}
          value={value}
          onChange={onChange}
          clearable={!required}
          searchable
          required={required}
          error={error}
          disabled={disabled}
          nothingFoundMessage={t('list.filters.noProjects')}
        />
        {isAdmin && (
          // type="button" is REQUIRED — without it Mantine <Button> falls back
          // to HTML default `type="submit"` and clicking this inside the
          // candidate form triggers form submit + redirect.
          <Button
            type="button"
            variant="light"
            leftSection={<Plus size={14} />}
            onClick={() => setModalOpen(true)}
          >
            {t('form.addProject')}
          </Button>
        )}
      </Group>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('form.addProjectTitle')}
        centered
      >
        <Stack>
          <TextInput
            label={t('fields.projectName')}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            error={createError}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button type="button" variant="subtle" onClick={() => setModalOpen(false)}>
              {t('form.cancel')}
            </Button>
            <Button type="button" onClick={handleCreate} loading={create.isPending} disabled={!newName.trim()}>
              {t('form.addProject')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
