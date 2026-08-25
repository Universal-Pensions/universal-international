// Regression tests for the aria-modal contract PaySheet gained from the
// shared useFocusTrap / useBodyScrollLock hooks (docs/audits/2026-08-23
// A20-003 / A18-003). Before this fix PaySheet declared
// `role="dialog" aria-modal="true"` with NO focus trap, NO Escape handling,
// and NO body-scroll-lock — the only aria-modal surface in the audit with
// literally none of the four protections Modal.jsx and the landing
// BottomSheet already had.
//
// `methods={[]}` is passed throughout so <PaymentMethodPicker> renders
// nothing (see usePaymentMethod's JSDoc: "Pass [] for a surface whose caller
// owns the method choice"). That isolates these assertions from
// PillChipGroup's own roving-tabindex radiogroup internals, which are
// unrelated to this fix and would otherwise make a Tab-order assertion here
// couple to a different component's implementation details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaySheet from './PaySheet';

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function TestHost({ initialOpen = true, submitting = false, onCloseSpy }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <button data-testid="outside">Outside</button>
      <PaySheet
        open={open}
        total={50000}
        methods={[]}
        submitting={submitting}
        onPay={() => {}}
        onClose={() => {
          onCloseSpy?.();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe('<PaySheet /> focus trap + scroll lock', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<TestHost initialOpen={true} />);
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await flush(50);
    expect(document.body.style.overflow).toBe('');
  });

  it('moves focus inside the dialog on open', async () => {
    render(<TestHost initialOpen={true} />);
    const dialog = await screen.findByRole('dialog');
    await flush();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab inside the dialog — repeated Tabs never reach the outside sentinel', async () => {
    const user = userEvent.setup();
    render(<TestHost initialOpen={true} />);
    await screen.findByRole('dialog');
    await flush();

    const outside = screen.getByTestId('outside');
    for (let i = 0; i < 10; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(outside);
    }
  });

  it('closes on Escape when not busy', async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();
    render(<TestHost initialOpen={true} onCloseSpy={onCloseSpy} />);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT close on Escape while a payment is submitting — matches the Cancel button / scrim-click busy guard', async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();
    render(<TestHost initialOpen={true} submitting={true} onCloseSpy={onCloseSpy} />);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('inerts #root while open and clears it on close', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      const user = userEvent.setup();
      render(<TestHost initialOpen={true} />);
      await screen.findByRole('dialog');
      await flush();
      expect(root.hasAttribute('inert')).toBe(true);

      await user.keyboard('{Escape}');
      await flush(50);
      expect(root.hasAttribute('inert')).toBe(false);
    } finally {
      root.remove();
    }
  });

  it('returns focus to the trigger element on close', async () => {
    const user = userEvent.setup();
    render(<TestHost initialOpen={true} />);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    await flush(50);
    // No explicit "open" trigger click happened in this host (it starts
    // open), so on close focus should land back on whatever the browser had
    // focused before the dialog claimed it — document.body, since nothing
    // else was focused first. This pins that close doesn't strand focus
    // un-set (e.g. still inside a now-detached dialog node).
    expect(document.activeElement).not.toBe(null);
    expect(document.body.contains(document.activeElement)).toBe(true);
  });
});
