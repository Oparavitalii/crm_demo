import { useRef, useState } from 'react';
import { ActionIcon, Group, Select } from '@mantine/core';
import { Pencil } from 'lucide-react';

interface Props {
  value: string | null;
  options: Array<{ value: string; label: string }>;
  onSave: (next: string | null) => void;
  // Renders the "display" state (when not editing). Receives the current value
  // so consumers can show badges / formatted text / etc.
  renderDisplay: (value: string | null) => React.ReactNode;
  // When true, the dropdown can be cleared back to null. Defaults to true.
  clearable?: boolean;
  // Optional width for the editor. Defaults to 140.
  width?: number;
  // Disabled state (e.g. while a parallel mutation is pending).
  disabled?: boolean;
}

// Click-to-edit cell. Shows the display node + a discreet pencil icon (hidden
// until hover) — clicking either swaps to a Select that auto-commits on change.
// Used in the candidates / clients lists to let recruiters fix small mistakes
// without opening the full edit page.
export function InlineSelectCell({
  value,
  options,
  onSave,
  renderDisplay,
  clearable = true,
  width = 140,
  disabled,
}: Props) {
  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function commit(next: string | null) {
    setEditing(false);
    if (next !== value) onSave(next);
  }

  if (editing) {
    return (
      <Select
        size="xs"
        w={width}
        data={options}
        value={value}
        onChange={(v) => commit(v)}
        onBlur={() => setEditing(false)}
        clearable={clearable}
        searchable
        autoFocus
        comboboxProps={{ withinPortal: true }}
      />
    );
  }

  return (
    <Group
      ref={containerRef}
      gap={4}
      wrap="nowrap"
      className="inline-edit-cell"
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        setEditing(true);
      }}
      style={{ cursor: disabled ? 'default' : 'pointer' }}
    >
      <div style={{ flex: 1 }}>{renderDisplay(value)}</div>
      {!disabled && (
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          className="inline-edit-icon"
          tabIndex={-1}
          aria-label="edit"
        >
          <Pencil size={12} />
        </ActionIcon>
      )}
    </Group>
  );
}
