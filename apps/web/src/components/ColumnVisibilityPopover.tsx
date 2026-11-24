import { ActionIcon, Button, Checkbox, Popover, Stack, Tooltip } from '@mantine/core';
import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataTableColumn } from 'mantine-datatable';

interface Props<T> {
  columns: DataTableColumn<T>[];
  hiddenCols: Set<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}

// Mirrors the "Колонки" popover used by CandidateList — same trigger button,
// same per-column checkbox layout, same "show all" footer. Shared so any list
// page can drop it in without re-implementing the keyboard / a11y plumbing.
export function ColumnVisibilityPopover<T>({ columns, hiddenCols, onToggle, onShowAll }: Props<T>) {
  const { t } = useTranslation('common');
  return (
    <Popover position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <Tooltip label={t('columns.title', { defaultValue: 'Колонки' })}>
          <ActionIcon variant="default" size="lg" aria-label="columns">
            <Columns3 size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <Stack gap={6}>
          {columns.map((col) => {
            const key = String(col.accessor);
            const title = typeof col.title === 'string' ? col.title : key;
            return (
              <Checkbox
                key={key}
                label={title}
                checked={!hiddenCols.has(key)}
                onChange={() => onToggle(key)}
              />
            );
          })}
          {hiddenCols.size > 0 && (
            <Button size="compact-xs" variant="subtle" onClick={onShowAll}>
              {t('columns.showAll', { defaultValue: 'Показати всі' })}
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
