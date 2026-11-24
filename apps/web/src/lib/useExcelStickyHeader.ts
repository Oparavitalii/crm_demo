import { useEffect, useRef } from 'react';

// Excel-style frozen header for a DataTable whose height is NOT bounded — the
// PAGE scrolls, not the table (client decision 2026-07-06: no viewport-bounded
// height). CSS position:sticky cannot do this: the nearest scroll container of
// the thead is the DataTable's own horizontal ScrollArea, which never scrolls
// vertically, so sticky never engages against window scroll. Instead the thead
// is shifted with translateY once the table's top passes the pin line (the
// sticky top-scrollbar strip, or the fixed app header when the strip is not
// rendered), clamped so the header stops at the table's last row.
//
// `active` must flip when the table (un)mounts — list view on desktop only —
// so the effect re-attaches to the fresh DOM node after kanban/mobile/error
// states unmount the DataTable.
export function useExcelStickyHeader(active: boolean) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  useEffect(() => {
    const table = tableRef.current;
    const thead = table?.querySelector('thead');
    if (!active || !table || !thead) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const strip = table
        .closest('.mantine-datatable')
        ?.parentElement?.querySelector('[data-table-top-scrollbar]');
      const pinLine =
        strip?.getBoundingClientRect().bottom ??
        document.querySelector('.mantine-AppShell-header')?.getBoundingClientRect().bottom ??
        0;
      const maxShift = Math.max(0, table.offsetHeight - thead.offsetHeight);
      const shift = Math.min(Math.max(0, pinLine - table.getBoundingClientRect().top), maxShift);
      if (shift > 0) {
        thead.style.transform = `translateY(${shift}px)`;
        thead.style.background = 'var(--mantine-datatable-background-color, var(--mantine-color-body))';
        thead.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.12)';
        // Chrome ignores position/z-index on table row groups (thead is
        // display:table-header-group), so row content that forms its own
        // stacking context (e.g. the computed-retention Badge with opacity)
        // would paint OVER the floating header in tree order. Positioning the
        // th cells individually is supported and wins the paint order.
        // Re-applied every tick so th elements recreated by a column toggle
        // pick the styles back up.
        for (const th of thead.querySelectorAll('th')) {
          th.style.position = 'relative';
          th.style.zIndex = '3';
        }
      } else {
        thead.style.transform = '';
        thead.style.background = '';
        thead.style.boxShadow = '';
        for (const th of thead.querySelectorAll('th')) {
          th.style.position = '';
          th.style.zIndex = '';
        }
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      thead.style.transform = '';
      thead.style.background = '';
      thead.style.boxShadow = '';
      for (const th of thead.querySelectorAll('th')) {
        th.style.position = '';
        th.style.zIndex = '';
      }
    };
  }, [active]);
  return tableRef;
}
