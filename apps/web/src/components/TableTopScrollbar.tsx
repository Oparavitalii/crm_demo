import { useEffect, useRef, useState, type RefObject } from 'react';

interface Props {
  // Scroll viewport to mirror (DataTable's `scrollViewportRef`). The strip and
  // the viewport drive each other's scrollLeft; browsers skip the scroll event
  // when scrollLeft is assigned an unchanged value, so there is no feedback loop.
  viewportRef: RefObject<HTMLDivElement | null>;
}

// Horizontal scrollbar rendered ABOVE a wide table. Client request 2026-07-06:
// the built-in scrollbar sits below the last row, so with a 20-row page you had
// to scroll all the way down before you could move sideways. Sticky under the
// fixed app header so it stays reachable while scrolling the page; also serves
// as the pin line for useExcelStickyHeader (data-table-top-scrollbar). Renders
// nothing when the table fits its viewport.
export function TableTopScrollbar({ viewportRef }: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      setScrollWidth(vp.scrollWidth);
      setClientWidth(vp.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    // Column toggle/resize changes the inner table width without resizing the
    // viewport itself — observe the content wrapper too.
    for (const child of Array.from(vp.children)) ro.observe(child);
    const onScroll = () => {
      if (stripRef.current) stripRef.current.scrollLeft = vp.scrollLeft;
    };
    vp.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      vp.removeEventListener('scroll', onScroll);
    };
  }, [viewportRef]);

  if (scrollWidth <= clientWidth) return null;

  return (
    <div
      ref={stripRef}
      aria-hidden
      data-table-top-scrollbar
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        position: 'sticky',
        top: 'var(--app-shell-header-height, 0px)',
        zIndex: 3,
        background: 'var(--mantine-color-body)',
      }}
      onScroll={(e) => {
        const vp = viewportRef.current;
        if (vp) vp.scrollLeft = e.currentTarget.scrollLeft;
      }}
    >
      <div style={{ width: scrollWidth, height: 1 }} />
    </div>
  );
}
