import { useState } from 'react';
import { Group, Table, Text, UnstyledButton } from '@mantine/core';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

// 2026-07-10 (client request) — column sorting for the analytics tables:
// first click sorts descending («від більшого до меншого»), second ascending,
// third restores the default order. Shared by the retention tables and the
// recruiter/coordinator KPI tabs so all of them behave identically.

export interface ColumnSort<K extends string> {
  col: K;
  dir: 'desc' | 'asc';
}

export function useColumnSort<K extends string>() {
  const [sort, setSort] = useState<ColumnSort<K> | null>(null);
  const toggle = (col: K) =>
    setSort((s) =>
      s?.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : null,
    );
  return { sort, toggle };
}

// Numeric sort with nulls LAST regardless of direction — a person with no
// tenure data should never float to the top of either ordering.
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: ColumnSort<K> | null,
  getters: Record<K, (row: T) => number | null>,
): T[] {
  if (!sort) return [...rows];
  const get = getters[sort.col];
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sort.dir === 'desc' ? vb - va : va - vb;
  });
}

interface SortableThProps {
  label: string;
  active: 'desc' | 'asc' | null;
  onSort: () => void;
}

export function SortableTh({ label, active, onSort }: SortableThProps) {
  return (
    <Table.Th ta="right">
      <UnstyledButton onClick={onSort} aria-label={`sort:${label}`} style={{ width: '100%' }}>
        <Group gap={4} justify="flex-end" wrap="nowrap">
          <Text size="sm" fw={700}>
            {label}
          </Text>
          {active === 'desc' ? (
            <ArrowDown size={12} />
          ) : active === 'asc' ? (
            <ArrowUp size={12} />
          ) : (
            <ArrowUpDown size={12} style={{ opacity: 0.35 }} />
          )}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}
