// RTL test for NeedsAttention's insurance row title (A14-004).
//
// Regression this guards: the row hardcoded the title "Group life cover", but
// `cover` is the group policy's TOTAL per-member amount — life + health
// combined on the seed (15.0M + 5.0M = 20.0M) — so the row overclaimed "life"
// for a figure that also includes health. The title is now a `label` prop
// defaulting to the accurate, general "Group cover" (its only caller,
// OverviewDesktop.jsx, does not pass this prop, so the default is what
// actually renders today) while staying overridable by a future caller that
// knows its enabled products.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NeedsAttention from './NeedsAttention';

describe('NeedsAttention insurance row title', () => {
  it('defaults to "Group cover", not "Group life cover", when the caller passes no label', () => {
    render(<NeedsAttention insuranceOn cover={20_000_000} />);
    expect(screen.getByText('Group cover')).toBeInTheDocument();
    expect(screen.queryByText('Group life cover')).toBeNull();
  });

  it('uses an explicit label when the caller provides one', () => {
    render(<NeedsAttention insuranceOn cover={20_000_000} label="Life + health cover" />);
    expect(screen.getByText('Life + health cover')).toBeInTheDocument();
    expect(screen.queryByText('Group cover')).toBeNull();
  });
});
