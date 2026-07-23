import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * VirtualRows — windowed list rendering for the mobile dashboards. The phone
 * shells use ONE natural-scroll container (`<main data-mobile-viewport>`), so a
 * long list (thousands of agents / subscribers) can't get its own bounded scroll
 * box without an awkward nested scroll. Instead we virtualize against the shell's
 * scroll element (found via `closest('[data-mobile-viewport]')`, so this works
 * unchanged under both the distributor and the admin shell) and offset by a
 * measured `scrollMargin` — the height of the cards ABOVE the list — so the whole
 * page scrolls as one while only the visible rows mount.
 *
 * `children(item, index)` renders one row; the wrapper is measured for its real
 * height (variable-height safe). Rows are keyed via `getKey`.
 */
export default function VirtualRows({ items, getKey, children, estimateSize = 68, overscan = 8 }) {
  const listRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const getScrollElement = useCallback(
    () => listRef.current?.closest('[data-mobile-viewport]') ?? null,
    [],
  );
  const estimate = useCallback(() => estimateSize, [estimateSize]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: estimate,
    overscan,
    scrollMargin,
  });

  // Measure the list's offset within the scroll container (the header cards above
  // it). getBoundingClientRect is robust to transformed ancestors (the page-entry
  // motion.div). Re-measure after the entry animation settles + on resize.
  useLayoutEffect(() => {
    const scrollEl = getScrollElement();
    const list = listRef.current;
    if (!scrollEl || !list) return undefined;
    const measure = () => {
      const top = list.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - top) > 0.5 ? top : prev));
    };
    measure();
    const t = setTimeout(measure, 380);
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(scrollEl);
    }
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [getScrollElement, items.length]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualItems.map((vi) => (
        <div
          key={getKey(items[vi.index], vi.index)}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${vi.start - scrollMargin}px)`,
          }}
        >
          {children(items[vi.index], vi.index)}
        </div>
      ))}
    </div>
  );
}
