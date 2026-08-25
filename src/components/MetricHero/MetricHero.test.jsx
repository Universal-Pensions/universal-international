// Tests for the MetricHero primitive (Phase 4 foundation — A22-002 / A15-002
// / A22-007: the shared hero must never render a confident zero in place of
// a failed read).
//
// Behaviours covered:
//   - normal render: every Tile's label/value/sub is visible, no alert/status
//   - a Tile with onClick renders as a button and fires the handler; a Tile
//     without onClick renders as a plain, non-interactive div
//   - isLoading renders a skeleton (role=status, aria-busy) — never the real
//     tile content, and never a bare "0"
//   - isError renders the shared ErrorCard (role=alert) with the message,
//     never the real tile content
//   - the Retry button calls onRetry exactly once, and is absent when
//     onRetry is not supplied
//   - isError takes precedence over isLoading when a consumer passes both
//   - the zero-vs-error distinction: a genuine value of "UGX 0" and a failed
//     read are never rendered the same way, and never rendered at the same time

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MetricHero, { MetricHeroTile } from './MetricHero';

function FourTiles() {
  return (
    <MetricHero>
      <MetricHero.Tile tone="indigo" label="Funds under management" value="UGX 2.45B" sub="3 distributors" />
      <MetricHero.Tile tone="green" label="Contributions" value="UGX 2.00B" sub="87% this month" />
      <MetricHero.Tile
        tone="teal"
        label="Subscribers"
        value="5,064"
        sub="3,968 active"
        onClick={() => {}}
      />
      <MetricHero.Tile tone="indigoSoft" label="Agents" value="2,046" sub="Across 321 branches" />
    </MetricHero>
  );
}

describe('<MetricHero /> compound API', () => {
  it('exposes MetricHero.Tile as the same component as the named export', () => {
    expect(MetricHero.Tile).toBe(MetricHeroTile);
  });
});

describe('<MetricHero /> ready state (normal render)', () => {
  it('renders every tile’s label, value and sub, with no error or loading affordance', () => {
    render(<FourTiles />);

    expect(screen.getByText('Funds under management')).toBeInTheDocument();
    expect(screen.getByText('UGX 2.45B')).toBeInTheDocument();
    expect(screen.getByText('3 distributors')).toBeInTheDocument();
    expect(screen.getByText('Contributions')).toBeInTheDocument();
    expect(screen.getByText('5,064')).toBeInTheDocument();
    expect(screen.getByText('2,046')).toBeInTheDocument();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('renders a Tile with onClick as a button and fires the handler on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MetricHero>
        <MetricHero.Tile label="Subscribers" value="5,064" onClick={onClick} />
      </MetricHero>,
    );

    const tile = screen.getByRole('button', { name: /subscribers/i });
    await user.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a Tile without onClick as a plain, non-interactive div', () => {
    const { container } = render(
      <MetricHero>
        <MetricHero.Tile label="Agents" value="2,046" />
      </MetricHero>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('div[data-clickable="true"]')).toBeNull();
  });

  it('defaults the grid column count to the number of Tile children, clamped to 4', () => {
    const { container } = render(<FourTiles />);
    expect(container.querySelector('[data-cols="4"]')).toBeInTheDocument();

    const { container: single } = render(
      <MetricHero>
        <MetricHero.Tile size="hero" label="Funds under management" value="UGX 2.45B" />
      </MetricHero>,
    );
    expect(single.querySelector('[data-cols="1"]')).toBeInTheDocument();
  });
});

describe('<MetricHero /> loading state', () => {
  it('renders a busy status region and NOT the real tile content (no confident zero)', () => {
    render(
      <MetricHero isLoading loadingLabel="Loading platform overview…">
        <MetricHero.Tile label="Funds under management" value="UGX 0" />
      </MetricHero>,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAccessibleName('Loading platform overview…');

    // The bug this primitive fixes: a loading/failed read must never render
    // as if it resolved to zero. Neither the label nor the "UGX 0" value the
    // eventual success render would show may appear while isLoading.
    expect(screen.queryByText('Funds under management')).toBeNull();
    expect(screen.queryByText('UGX 0')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders one skeleton placeholder per Tile child so the layout does not jump', () => {
    const { container } = render(
      <MetricHero isLoading>
        <MetricHero.Tile label="A" value="1" />
        <MetricHero.Tile label="B" value="2" />
        <MetricHero.Tile label="C" value="3" />
      </MetricHero>,
    );
    expect(container.querySelectorAll('.skeletonTile')).toHaveLength(3);
  });
});

describe('<MetricHero /> error state', () => {
  it('renders the shared ErrorCard (role=alert) with the message, and NOT the real tile content', () => {
    render(
      <MetricHero isError error="Could not load platform overview." onRetry={() => {}}>
        <MetricHero.Tile label="Funds under management" value="UGX 0" />
      </MetricHero>,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not load platform overview.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();

    expect(screen.queryByText('Funds under management')).toBeNull();
    expect(screen.queryByText('UGX 0')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('calls onRetry exactly once when Retry is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MetricHero isError error="Network error" onRetry={onRetry}>
        <MetricHero.Tile label="Funds under management" value="UGX 0" />
      </MetricHero>,
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the Retry button when onRetry is not supplied', () => {
    render(
      <MetricHero isError error="Network error">
        <MetricHero.Tile label="Funds under management" value="UGX 0" />
      </MetricHero>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('takes precedence over isLoading when a consumer passes both', () => {
    render(
      <MetricHero isError isLoading error="Network error" onRetry={() => {}}>
        <MetricHero.Tile label="Funds under management" value="UGX 0" />
      </MetricHero>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('<MetricHero /> zero-vs-error distinction', () => {
  it('never renders a genuine zero the same way it renders a failed read, and never both at once', () => {
    const onRetry = vi.fn();
    const tile = (
      <MetricHero.Tile label="Funds under management" value="UGX 0" sub="Platform-wide" />
    );

    // 1) The read succeeded and the real figure genuinely is zero (e.g. a
    //    brand-new distributor with no branches yet). This must render
    //    plainly, as data — no error affordance anywhere.
    const { rerender } = render(
      <MetricHero isLoading={false} isError={false} onRetry={onRetry}>
        {tile}
      </MetricHero>,
    );
    expect(screen.getByText('UGX 0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();

    // 2) The SAME shape of read now fails. The hero must switch to an
    //    unmistakable error state with a retry — and must stop rendering
    //    "UGX 0", which would otherwise be indistinguishable from a
    //    genuinely empty platform.
    rerender(
      <MetricHero isLoading={false} isError error="Could not reach the server." onRetry={onRetry}>
        {tile}
      </MetricHero>,
    );
    expect(screen.queryByText('UGX 0')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not reach the server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
