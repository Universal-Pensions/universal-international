import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatNumber } from '../../utils/currency';
import styles from './ReportTable.module.css';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/**
 * Shared sortable/filterable data table for reports.
 *
 * @param {Object} props
 * @param {Array} props.columns — [{ key, label, sortable?, render?, align?, width? }]
 * @param {Array} props.data — Array of row objects
 * @param {string} props.defaultSort — Default sort column key
 * @param {'asc'|'desc'} props.defaultDir — Default sort direction
 * @param {Function} props.onRowClick — Optional row click handler (row) => void
 * @param {string} props.rowKey — Key to use as unique row identifier (default: 'id')
 * @param {boolean} props.loading — Show loading state
 * @param {string} props.ariaLabel — Accessible name for the horizontal scroll region
 *   (A20-005). The region is focusable so keyboard users can scroll it; without a
 *   name a screen reader announces only "group". Defaults to plain-language copy.
 */
export default function ReportTable({
  columns,
  data = [],
  defaultSort,
  defaultDir = 'desc',
  onRowClick,
  rowKey = 'id',
  loading = false,
  ariaLabel = 'Table, scroll sideways to see more',
}) {
  const reducedMotion = useReducedMotion();
  const [sortKey, setSortKey] = useState(defaultSort || columns[0]?.key);
  const [sortDir, setSortDir] = useState(defaultDir);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  }, [sortKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    const getValue = col?.sortValue || ((row) => row[sortKey]);
    return [...data].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [data, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Clamp to the last valid page without a render-phase setState (avoids a
  // stale empty-slice frame). safePage === page whenever page is in range.
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const paginated = useMemo(
    () => sorted.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [sorted, safePage, pageSize]
  );

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Loading report data…</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        <svg viewBox="0 0 24 24" fill="none" width="36" height="36" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 9h6M9 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>No data available</span>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <div role="region" className={styles.tableScroll} tabIndex={0} aria-label={ariaLabel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.rowNum}>#</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={styles.th}
                  data-align={col.align || 'left'}
                  aria-sort={
                    col.sortable !== false && sortKey === col.key
                      ? (sortDir === 'asc' ? 'ascending' : 'descending')
                      : 'none'
                  }
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                >
                  {col.sortable !== false ? (
                    <button
                      type="button"
                      className={styles.sortBtn}
                      onClick={() => handleSort(col.key)}
                      data-active={sortKey === col.key}
                      data-align={col.align || 'left'}
                      aria-label={`Sort by ${col.label}${sortKey === col.key ? (sortDir === 'asc' ? ', ascending' : ', descending') : ''}`}
                    >
                      <span>{col.label}</span>
                      <span className={styles.sortIcon} data-dir={sortKey === col.key ? sortDir : 'none'}>
                        {sortKey === col.key && sortDir === 'asc' ? (
                          <svg viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
                            <path d="M6 9V3M6 3L3 6M6 3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : sortKey === col.key && sortDir === 'desc' ? (
                          <svg viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
                            <path d="M6 3v6M6 9L3 6M6 9l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
                            <path d="M6 2v8M3 5l3-3 3 3M3 7l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
                          </svg>
                        )}
                      </span>
                    </button>
                  ) : (
                    <span data-align={col.align || 'left'}>{col.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {paginated.map((row, idx) => (
                <motion.tr
                  key={row[rowKey]}
                  className={styles.tr}
                  data-clickable={!!onRowClick}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={reducedMotion ? undefined : { opacity: 1 }}
                  transition={{ duration: 0.15, delay: reducedMotion ? 0 : Math.min(idx * 0.01, 0.2), ease: EASE_OUT_EXPO }}
                  layout={!reducedMotion}
                >
                  <td className={styles.rowNum}>{safePage * pageSize + idx + 1}</td>
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td} data-align={col.align || 'left'}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className={styles.pagination}>
        <div className={styles.pageInfo}>
          <span className={styles.pageCount}>
            {formatNumber(safePage * pageSize + 1)}–{formatNumber(Math.min((safePage + 1) * pageSize, sorted.length))} of {formatNumber(sorted.length)}
          </span>
        </div>
        <div className={styles.pageControls}>
          <div className={styles.pageSizeWrap}>
            <label htmlFor="pageSize" className={styles.pageSizeLabel}>Rows</label>
            <select
              id="pageSize"
              className={styles.pageSizeSelect}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className={styles.pageNumber}>{safePage + 1} / {totalPages}</span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            disabled={safePage >= totalPages - 1}
            aria-label="Next page"
          >
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
