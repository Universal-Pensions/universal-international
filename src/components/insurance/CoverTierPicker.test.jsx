// Tests for CoverTierPicker — the shared cover-amount ladder used by the signup
// cover step, the schedule editor and the settings cover page.
//
// The accessible-name contract matters beyond a11y: the signup step renders one
// picker per selected product, so the `role="group"` name is what keeps three
// simultaneous pickers addressable, and the E2E helper selects tiers by the
// mark's aria-label (exact figures) rather than the compact visible text.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CoverTierPicker from './CoverTierPicker';

function renderPicker(props = {}) {
  const onChange = vi.fn();
  const utils = render(
    <CoverTierPicker
      productId="life"
      value={1_000_000}
      onChange={onChange}
      label="Life cover amount"
      {...props}
    />,
  );
  return { ...utils, onChange };
}

describe('<CoverTierPicker />', () => {
  it('exposes a named group with one mark per ladder tier', () => {
    renderPicker();
    const group = screen.getByRole('group', { name: 'Life cover amount' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
  });

  it('names each mark with its exact cover and annual premium', () => {
    renderPicker();
    // Visible text is compact; the accessible name carries the real figures.
    expect(screen.getByText('UGX 2.0M')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'UGX 2,000,000 cover, UGX 42,000 per year' }),
    ).toBeInTheDocument();
  });

  it('marks the tier matching `value` as active', () => {
    renderPicker({ value: 3_000_000 });
    const active = screen.getByRole('button', { name: /^UGX 3,000,000 cover/ });
    expect(active).toHaveAttribute('data-active', 'true');
  });

  it('fires onChange with the cover and the resolved tier when a mark is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^UGX 5,000,000 cover/ }));
    expect(onChange).toHaveBeenCalledWith(
      5_000_000,
      expect.objectContaining({ cover: 5_000_000, premiumMonthly: 7_500, index: 3 }),
    );
  });

  it('describes the selection on the range input for screen readers', () => {
    renderPicker({ value: 2_000_000 });
    expect(screen.getByRole('slider', { name: 'Life cover amount' })).toHaveAttribute(
      'aria-valuetext',
      'UGX 2.0M cover, UGX 42,000 per year',
    );
  });

  it('snaps an off-ladder cover down to the nearest tier rather than to the entry tier', () => {
    // Regression guard for the retired InsurancePage behaviour, where an
    // off-ladder cover collapsed to index 0 and offered a bogus downgrade.
    renderPicker({ value: 4_000_000 });
    expect(screen.getByRole('button', { name: /^UGX 3,000,000 cover/ })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^UGX 1,000,000 cover/ })).toHaveAttribute('data-active', 'false');
  });

  it('reads out the selected payout and yearly price', () => {
    renderPicker({ value: 5_000_000 });
    expect(screen.getByText(/Pays/)).toHaveTextContent('Pays UGX 5,000,000 · UGX 90,000 / year');
  });

  it('omits the readout when showReadout={false}', () => {
    renderPicker({ showReadout: false });
    expect(screen.queryByText(/Pays/)).toBeNull();
  });

  it('uses the product-specific ladder, not life’s', () => {
    renderPicker({ productId: 'health', value: 8_000_000, label: 'Hospital cash cover amount' });
    expect(screen.getByRole('button', { name: /^UGX 12,000,000 cover/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^UGX 8,000,000 cover/ })).toHaveAttribute('data-active', 'true');
  });

  it('blocks selection when disabled', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ disabled: true });
    await user.click(screen.getByRole('button', { name: /^UGX 5,000,000 cover/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('slider')).toBeDisabled();
  });

  it('renders nothing for a product with no ladder', () => {
    const { container } = renderPicker({ productId: 'motor' });
    expect(container).toBeEmptyDOMElement();
  });

  it('drops the repeated UGX prefix in the compact card variant', () => {
    // Four "UGX 5.0M" labels overflow and clip inside a ~200px product card in
    // the signup 3-up grid. The currency is stated right above each card, so the
    // visible mark drops it — but the accessible name must keep the full figure.
    renderPicker({ variant: 'card' });
    expect(screen.getByText('5.0M')).toBeInTheDocument();
    expect(screen.queryByText('UGX 5.0M')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'UGX 5,000,000 cover, UGX 90,000 per year' }),
    ).toBeInTheDocument();
  });
});
