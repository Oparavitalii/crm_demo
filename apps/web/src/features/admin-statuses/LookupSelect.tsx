import { useState, type ReactNode } from 'react';
import { Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusLookup, StatusLookupType } from '@crm/shared';
import { useStatusLookup, useCreateStatusLookup } from './useStatusLookup';

interface Props {
  type: StatusLookupType;
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  // Mantine v7 Select accepts any ReactNode for error so a Mantine
  // `useForm().errors[...]` value (which is React.ReactNode) flows straight in
  // without an unsafe `as string` cast at the call site.
  error?: ReactNode;
  disabled?: boolean;
}

// Generalized reusable Select that pulls active rows from `status_lookups` for
// the given type and renders a "+ Dodaj nową" button which opens an inline
// modal to create a new option. Used today for `position` and `legal_status`
// on the candidate form (any authenticated user can add). The backend
// per-type role check (see routes/status-lookups.ts) decides whether the
// create call succeeds; on a permission denial the error surfaces in the
// modal as inline text rather than a notification.
function buildOptions(
  items: StatusLookup[] | undefined,
  current: string | null,
  language: string,
): Array<{ value: string; label: string }> {
  const base = (items ?? []).map((r) => ({
    value: r.code,
    label: language === 'pl' ? r.labelPl : r.labelUa,
  }));
  if (current && !base.some((o) => o.value === current)) {
    base.push({ value: current, label: current });
  }
  return base;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export function LookupSelect({
  type,
  value,
  onChange,
  label,
  placeholder,
  required,
  error,
  disabled,
}: Props) {
  const { t, i18n } = useTranslation('candidates');
  const { data } = useStatusLookup(type);
  const create = useCreateStatusLookup();

  const [modalOpen, setModalOpen] = useState(false);
  const [labelPl, setLabelPl] = useState('');
  const [labelUa, setLabelUa] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const options = buildOptions(data, value, i18n.language);

  function resetForm() {
    setLabelPl('');
    setLabelUa('');
    setCreateError(null);
  }

  async function handleCreate() {
    setCreateError(null);
    const pl = labelPl.trim();
    const ua = labelUa.trim();
    if (!pl || !ua) {
      setCreateError(t('lookup.errors.bothLabelsRequired'));
      return;
    }
    // Build a stable code from the PL label; fall back to UA if PL slugifies
    // to an empty string (all non-latin chars). The backend Zod
    // `statusLookupCodeSchema` enforces ^[a-z][a-z0-9_]{1,49}$.
    let code = slugify(pl) || slugify(ua);
    if (!code || !/^[a-z]/.test(code)) {
      // Prefix with `x_` so codes that start with a digit still validate.
      code = `x_${code || Date.now().toString(36)}`.slice(0, 50);
    }
    try {
      const row = await create.mutateAsync({
        type,
        code,
        labelPl: pl,
        labelUa: ua,
        sortOrder: 999,
      });
      onChange(row.code);
      resetForm();
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
          label={label}
          placeholder={placeholder}
          data={options}
          value={value}
          onChange={onChange}
          clearable={!required}
          searchable
          required={required}
          error={error}
          disabled={disabled}
        />
        {/* type="button" is REQUIRED — Mantine <Button> has no defaultProps
            for `type`, so the browser falls back to the HTML default
            (`submit`), and clicking this button inside the candidate form
            would trigger form submit + redirect. */}
        <Button
          type="button"
          variant="light"
          leftSection={<Plus size={14} />}
          onClick={() => setModalOpen(true)}
          disabled={disabled}
        >
          {t('lookup.add')}
        </Button>
      </Group>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetForm();
        }}
        title={t('lookup.addTitle', { field: label })}
        centered
      >
        <Stack>
          <TextInput
            label={t('lookup.labelPl')}
            value={labelPl}
            onChange={(e) => setLabelPl(e.currentTarget.value)}
            data-autofocus
            required
          />
          <TextInput
            label={t('lookup.labelUa')}
            value={labelUa}
            onChange={(e) => setLabelUa(e.currentTarget.value)}
            required
          />
          {createError && (
            <Text c="red" size="sm">
              {createError}
            </Text>
          )}
          <Group justify="flex-end">
            {/* Modal renders in a Portal so its buttons are technically outside
                the parent <form>, but we still set type="button" defensively
                — Mantine has no default, and a future refactor that disables
                the portal would re-introduce the accidental-submit bug. */}
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                setModalOpen(false);
                resetForm();
              }}
            >
              {t('form.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              loading={create.isPending}
              disabled={!labelPl.trim() || !labelUa.trim()}
            >
              {t('lookup.add')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
