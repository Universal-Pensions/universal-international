// Cross-cutting contract test — the four dashboard BottomSheet copies (agent /
// branch / subscriber / employer) all declare `role="dialog" aria-modal="true"`
// and must honour it identically. docs/audits/2026-08-23 A17-003 / A20-003 /
// A18-003: all four drifted from the landing shell's hardened original — each
// independently hand-rolled an Escape-only `keydown` listener, with no focus
// trap, no background `inert`, no focus-restore on close, and no
// body-scroll-lock. `aria-modal="true"` was therefore a false promise on every
// authenticated mobile surface that opens one of these (Ask AI / Notifications
// / Help sheets across four roles).
//
// The fix moves all four onto the shared useFocusTrap / useBodyScrollLock
// hooks (src/hooks/) instead of adding a SIXTH hand-rolled copy. This file
// proves the contract holds for each REAL component file — not a stand-in —
// parametrized over all four, so the assertions are written once instead of
// pasted four times (the exact copy-paste drift this fix undoes, now one
// level up at the test layer instead of the implementation layer).
//
// The admin dashboard reuses the branch copy directly rather than keeping a
// fifth copy of its own (src/admin-dashboard/attention/AdminAttentionMobile.jsx
// and .../mobile/AdminNavMobile.jsx both `import BottomSheet from
// '../../branch-dashboard/shell/BottomSheet'`), so exercising "branch" here
// also covers admin.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AgentBottomSheet from '../agent-dashboard/shell/BottomSheet';
import BranchBottomSheet from '../branch-dashboard/shell/BottomSheet';
import SubscriberBottomSheet from '../subscriber-dashboard/shell/BottomSheet';
import EmployerBottomSheet from '../employer-dashboard/shell/BottomSheet';

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const COPIES = [
  ['agent', AgentBottomSheet],
  ['branch (also the admin dashboard, which imports this file directly)', BranchBottomSheet],
  ['subscriber', SubscriberBottomSheet],
  ['employer', EmployerBottomSheet],
];

function TestHost(props) {
  // Destructuring `Sheet` straight out of the parameter list (instead of via
  // this local `const`) trips this project's `no-unused-vars` config: JSX-tag
  // usage of a destructured PARAMETER isn't recognised as a "use" here (only
  // `const`/`let` bindings get that — and the `varsIgnorePattern: '^[A-Z_]'`
  // exemption for capitalised names — see the other dynamic-component-via-prop
  // pattern in src/pages/landing/shell/LandingMobileShell.jsx, which is a
  // `const`, not a destructured parameter, for the same reason).
  const { Sheet, initialOpen = false } = props;
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" data-testid="outside">
        Outside
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Test sheet">
        <button type="button" data-testid="inner-a">Inner A</button>
        <button type="button" data-testid="inner-b">Inner B</button>
      </Sheet>
    </div>
  );
}

describe.each(COPIES)('%s BottomSheet — shared aria-modal contract', (_label, Sheet) => {
  let root;

  beforeEach(() => {
    document.body.style.overflow = '';
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.style.overflow = '';
    root.remove();
  });

  it('renders nothing — and therefore zero tabbable elements — while closed', () => {
    render(<TestHost Sheet={Sheet} initialOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  it('renders into a portal at document.body when open', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={false} />);
    await user.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('moves focus inside the sheet on open', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={false} />);
    await user.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    await flush();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab inside the sheet — repeated Tabs never reach the outside sentinel', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={false} />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();

    const outside = screen.getByTestId('outside');
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(outside);
    }
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={true} />);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    // The dialog's removal waits on AnimatePresence's exit transition
    // (0.34s) to finish before React actually unmounts it — a fixed short
    // flush is racy here (unlike the effect-driven assertions elsewhere in
    // this file — scroll lock, inert, focus — which resolve synchronously
    // with the `open` state flip and don't need this). Poll instead of
    // guessing a duration.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('returns focus to the trigger element on close', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={false} />);
    const trigger = screen.getByTestId('trigger');
    await user.click(trigger);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    await flush(50);
    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={true} />);
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await flush(50);
    expect(document.body.style.overflow).toBe('');
  });

  it('inerts #root while open and clears it on close', async () => {
    const user = userEvent.setup();
    render(<TestHost Sheet={Sheet} initialOpen={true} />);
    await screen.findByRole('dialog');
    await flush();
    expect(root.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Escape}');
    await flush(50);
    expect(root.hasAttribute('inert')).toBe(false);
  });
});
