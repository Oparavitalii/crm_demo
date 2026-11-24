import type { DataTableColumn } from 'mantine-datatable';

// Drops columns where every visible row has a null / undefined / empty-string
// value at that column's accessor. Auto-hide is evaluated against the currently
// loaded page only — there is no attempt to query other pages.
//
// `alwaysShow` is a whitelist of column accessor keys that must never be
// auto-hidden (e.g. primary name / status / action columns). Pass an empty
// array if every column is fair game.
//
// The accessor may be a dotted path like 'candidate.firstName'; we read it
// shallowly here — list endpoints flatten joins onto the row so dotted paths
// are rare in this codebase.
export function filterColumnsByData<T extends Record<string, unknown>>(
  columns: DataTableColumn<T>[],
  rows: readonly T[],
  alwaysShow: readonly string[] = [],
): DataTableColumn<T>[] {
  // No data → keep every column so the empty-state still renders headers.
  if (rows.length === 0) return columns;
  const keep = new Set(alwaysShow.map(String));
  return columns.filter((col) => {
    const key = String(col.accessor);
    if (keep.has(key)) return true;
    const hasAny = rows.some((row) => {
      const v = readPath(row, key);
      if (v === null || v === undefined) return false;
      if (typeof v === 'string' && v.trim() === '') return false;
      return true;
    });
    return hasAny;
  });
}

function readPath(row: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return row[path];
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
