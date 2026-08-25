// Tests for the ReportTable pagination page-clamp behaviour (§07-L1).
//
// Behaviours covered:
//   - in-range pages show the expected page indicator + range readout
//   - navigating to a deep page reflects that page in the indicator + readout
//   - when the data set shrinks so the current page overflows, the table
//     clamps to the LAST valid page (not page 1) — the indicator and range
//     readout (both derived from safePage) reflect the last valid page, never
//     a bounced page 1.
//
// We assert on the page indicator ("N / M") and the "a-b of total" readout
// rather than raw row nodes: both derive directly from safePage, and the
// AnimatePresence row transitions leave transient exit nodes in the DOM that
// would make row-counting brittle.

import { describe, it, expect } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import ReportTable from './ReportTable';

const columns = [{ key: 'name', label: 'Name', sortable: false }];

function makeRows(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
}

// The "N / M" page indicator lives in its own <span> in the pagination footer.
function pageIndicator(scope) {
  return scope.getByText(/^\d+ \/ \d+$/);
}

describe('<ReportTable /> pagination clamp', () => {
  it('shows the first page indicator and range readout for in-range data', () => {
    const { container } = render(<ReportTable columns={columns} data={makeRows(60)} />);
    const scope = within(container);
    expect(pageIndicator(scope).textContent).toBe('1 / 3');
    expect(scope.getByText('1–25 of 60')).toBeInTheDocument();
  });

  it('navigates to a deep page and reflects it in the indicator + readout', () => {
    const { container } = render(<ReportTable columns={columns} data={makeRows(60)} />);
    const scope = within(container);
    const next = scope.getByLabelText('Next page');
    fireEvent.click(next); // page 2
    fireEvent.click(next); // page 3 (last)
    expect(pageIndicator(scope).textContent).toBe('3 / 3');
    expect(scope.getByText('51–60 of 60')).toBeInTheDocument();
  });

  it('clamps to the last valid page (not page 1) when data shrinks below the current page', () => {
    const { container, rerender } = render(<ReportTable columns={columns} data={makeRows(60)} />);
    const scope = within(container);
    const next = scope.getByLabelText('Next page');
    fireEvent.click(next);
    fireEvent.click(next); // now on page 3 of 3
    expect(pageIndicator(scope).textContent).toBe('3 / 3');

    // Data shrinks to 30 rows -> 2 pages. Page index 2 is now out of range.
    rerender(<ReportTable columns={columns} data={makeRows(30)} />);

    // Clamps to the LAST valid page (page 2), NOT page 1 — both the indicator
    // and the range readout derive from safePage and show the clamped page.
    expect(pageIndicator(scope).textContent).toBe('2 / 2');
    expect(scope.getByText('26–30 of 30')).toBeInTheDocument();
  });

  it('keeps page state when the data set still covers the current page', () => {
    const { container, rerender } = render(<ReportTable columns={columns} data={makeRows(60)} />);
    const scope = within(container);
    const next = scope.getByLabelText('Next page');
    fireEvent.click(next); // page 2 of 3
    expect(pageIndicator(scope).textContent).toBe('2 / 3');

    // 80 rows -> 4 pages; page 2 is still in range, so the page is preserved.
    rerender(<ReportTable columns={columns} data={makeRows(80)} />);
    expect(pageIndicator(scope).textContent).toBe('2 / 4');
    expect(scope.getByText('26–50 of 80')).toBeInTheDocument();
  });
});

// A20-005 — the horizontal scrollport must be reachable without a pointer.
// `.tableScroll` is `overflow-x: auto`, so on a narrow viewport the columns past
// the fold can only be reached by scrolling it. A div is not focusable by
// default, so keyboard users could not scroll it at all.
describe('ReportTable — scrollable region is keyboard-accessible (A20-005)', () => {
  it('exposes the scrollport as a focusable, named region', () => {
    const { container } = render(<ReportTable columns={columns} data={makeRows(3)} />);
    const scrollport = container.querySelector('[aria-label]');

    expect(scrollport).not.toBeNull();
    expect(scrollport.getAttribute('tabindex')).toBe('0');
    // Default copy, plain language per the house rule — no jargon.
    expect(scrollport.getAttribute('aria-label')).toBe('Table, scroll sideways to see more');
    expect(scrollport.querySelector('table')).not.toBeNull();
  });

  it('lets a caller name the region for its own table', () => {
    const { container } = render(
      <ReportTable columns={columns} data={makeRows(3)} ariaLabel="All withdrawals" />,
    );
    expect(container.querySelector('[aria-label="All withdrawals"]')).not.toBeNull();
  });
});
