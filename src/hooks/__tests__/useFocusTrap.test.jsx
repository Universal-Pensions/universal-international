// Tests for the shared useFocusTrap primitive (src/hooks/useFocusTrap.js).
//
// Covers the contract every aria-modal="true" surface in this codebase is
// supposed to honour, and that four dashboard BottomSheet copies + PaySheet
// silently did not (docs/audits/2026-08-23 A17-003 / A20-003):
//   - Tab / Shift+Tab cannot move focus outside the trapped container,
//   - Escape calls onClose,
//   - focus moves into the container on open and returns to the trigger on close,
//   - the background (#root) is inert while open, and not otherwise.
//
// It also proves the mechanism the hook needs to close A20-004 (a closed
// landing-nav drawer keeping 7 focusables tabbable under aria-hidden="true"):
// an ALWAYS-MOUNTED container (never unmounted, only toggled — the pattern a
// drawer that must animate uses, unlike BottomSheet's conditional render)
// goes from 7 tabbable descendants to 0 the instant `open` becomes false, via
// the hook's container-self `inert` sync. Wiring an actual drawer component to
// this hook is out of scope here (src/pages/landing/LandingNav.jsx is outside
// this write-set) — this test pins the primitive's behaviour so that wiring
// is a drop-in.

import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusTrap, getFocusableElements } from '../useFocusTrap';

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// Conditionally-rendered dialog host — mirrors how BottomSheet/PaySheet use
// the hook: the trapped container only exists in the DOM while `open`.
function DialogHost({ onCloseSpy }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  useFocusTrap(open, containerRef, {
    onClose: () => {
      onCloseSpy?.();
      setOpen(false);
    },
  });

  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <button data-testid="outside">Outside</button>
      {open && (
        <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Test dialog">
          <button data-testid="first-btn">First</button>
          <input data-testid="middle-input" />
          <button data-testid="last-btn">Last</button>
        </div>
      )}
    </div>
  );
}

// Always-mounted show/hide host — mirrors LandingNav's drawer: the container
// never unmounts, `open` only toggles a class + aria-hidden. This is the
// shape A20-004 needs. 7 focusables, matching the finding's DOM probe
// (['BUTTON:Close menu','A:Subscribers','A:Employers','A:Distributors',
// 'A:Administrator','BUTTON:Sign in','A:Start saving']).
function DrawerHost() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  useFocusTrap(open, containerRef, { onClose: () => setOpen(false), inertSelector: null });

  return (
    <div>
      <button data-testid="hamburger" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <div
        ref={containerRef}
        data-testid="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        aria-hidden={!open}
      >
        <button data-testid="close-menu">Close menu</button>
        <a href="/">Subscribers</a>
        <a href="/employers">Employers</a>
        <a href="/distributors">Distributors</a>
        <a href="/admin">Administrator</a>
        <button data-testid="sign-in">Sign in</button>
        <a href="/signup">Start saving</a>
      </div>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element on open', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId('first-btn'));
  });

  it('traps Tab: last -> first', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();

    screen.getByTestId('last-btn').focus();
    expect(document.activeElement).toBe(screen.getByTestId('last-btn'));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('first-btn'));
  });

  it('traps Shift+Tab: first -> last', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();

    screen.getByTestId('first-btn').focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByTestId('last-btn'));
  });

  it('never lands focus on the "outside" trigger button while open, no matter how many Tabs are pressed', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();

    const outside = screen.getByTestId('outside');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(outside);
    }
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onCloseSpy = vi.fn();
    render(<DialogHost onCloseSpy={onCloseSpy} />);
    await user.click(screen.getByTestId('trigger'));
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the trigger element on close', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    const trigger = screen.getByTestId('trigger');
    await user.click(trigger);
    await screen.findByRole('dialog');
    await flush();

    await user.keyboard('{Escape}');
    await flush(50);
    expect(document.activeElement).toBe(trigger);
  });

  it('inerts #root while open and removes it on close', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      const user = userEvent.setup();
      render(<DialogHost />);
      await user.click(screen.getByTestId('trigger'));
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

  describe('always-mounted container (the A20-004 drawer shape)', () => {
    it('starts with 0 tabbable descendants while closed, despite aria-hidden alone never removing them from the DOM', () => {
      render(<DrawerHost />);
      // A plain getByTestId, not getByRole: an aria-hidden="true" element's
      // COMPUTED ACCESSIBLE NAME is "" per the accname spec's "hidden and not
      // referenced" rule — aria-label alone does not survive it — so
      // getByRole('dialog', { name: ..., hidden: true }) cannot find this
      // element while closed even with `hidden: true` (which only bypasses
      // the visibility FILTER, not name computation). That is itself exactly
      // the shape of the underlying bug: assistive tech sees nothing here,
      // while raw DOM/Tab traversal still can. getByTestId sidesteps ARIA
      // entirely, which is what we want to inspect the raw DOM underneath it.
      const drawer = screen.getByTestId('drawer');
      // The 7 elements exist in the DOM (aria-hidden hides them from AT, not
      // from querySelectorAll) — this is exactly the A20-004 defect shape.
      expect(drawer.querySelectorAll('button, a').length).toBe(7);
      // But none of them are reachable via Tab: getFocusableElements is what
      // the hook's own Tab handler uses to compute the trap boundary.
      expect(getFocusableElements(drawer).length).toBe(0);
      expect(drawer.hasAttribute('inert')).toBe(true);
    });

    it('goes from 0 -> 7 tabbable descendants when opened, and back to 0 on close', async () => {
      const user = userEvent.setup();
      render(<DrawerHost />);
      const drawer = screen.getByTestId('drawer');
      expect(getFocusableElements(drawer).length).toBe(0);

      await user.click(screen.getByTestId('hamburger'));
      await flush();
      expect(drawer.hasAttribute('inert')).toBe(false);
      expect(getFocusableElements(drawer).length).toBe(7);

      await user.keyboard('{Escape}');
      await flush(50);
      expect(drawer.hasAttribute('inert')).toBe(true);
      expect(getFocusableElements(drawer).length).toBe(0);
    });
  });
});

describe('getFocusableElements', () => {
  it('returns [] for a null root', () => {
    expect(getFocusableElements(null)).toEqual([]);
  });

  it('excludes aria-hidden, hidden, disabled, display:none and visibility:hidden descendants', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <button id="ok">ok</button>
      <button id="ah" aria-hidden="true">hidden-aria</button>
      <button id="hd" hidden>hidden-attr</button>
      <button id="ds" disabled>disabled</button>
      <button id="dn" style="display:none">display-none</button>
      <button id="vh" style="visibility:hidden">visibility-hidden</button>
    `;
    document.body.appendChild(root);
    try {
      const ids = getFocusableElements(root).map((el) => el.id);
      expect(ids).toEqual(['ok']);
    } finally {
      root.remove();
    }
  });

  it('excludes descendants of an inert ancestor even if the descendant itself has no inert-relevant attribute', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="wrap" inert><button id="inner">inner</button></div>
      <button id="sibling">sibling</button>
    `;
    document.body.appendChild(root);
    try {
      const ids = getFocusableElements(root).map((el) => el.id);
      expect(ids).toEqual(['sibling']);
    } finally {
      root.remove();
    }
  });
});
