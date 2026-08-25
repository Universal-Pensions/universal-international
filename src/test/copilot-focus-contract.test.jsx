// AUDIT A19-005 / A19-006 / A19-007 — the distributor + admin "Ask AI"
// Copilot (DataCopilotPanel.jsx, shared by both map-theme shells via
// AskAiFab + CopilotChat).
//
// A19-005: the panel declares role="dialog" aria-modal="true" but had no Tab
// handler, so focus walked straight into the background sidebar. Fixed with a
// real Tab/Shift+Tab trap (mirroring Modal.jsx's contract, though this panel
// is not portaled so it could not reuse useFocusTrap.js's #root-inerting
// design verbatim — see DataCopilotPanel.jsx's own comments).
//
// A19-006: closing the Copilot left focus stranded on whatever the Tab trap
// had last landed on in the background; the owning shells now pass a
// `closeCopilot` that returns focus to the Ask-AI trigger.
//
// A19-007: considered and rejected converting this to the OTHER four roles'
// non-modal grid-push interaction model (see the AUDIT A19-007 comment on
// DataCopilotPanel.jsx) — this shell's other overlays (ViewBranches,
// CommissionPanel, ViewReports, Settings) are ALL modal-when-a-drawer, so
// this panel is correctly modal too. What A19-007 does require, and what the
// last test below asserts, is that the contract stays SELF-CONSISTENT:
// aria-modal="true" is never shipped without an actual trap behind it.
//
// The harness below wires AskAiFab + DataCopilotPanel exactly the way
// DashboardShell.jsx / AdminDashboardShell.jsx do (askAiRef + closeCopilot
// via requestAnimationFrame) rather than mounting the full heavy shells, so
// this is a faithful integration test of the real focus contract without
// pulling in Leaflet / Sidebar / the map chrome.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../hooks/useEntity', () => ({
  usePlatformOverview: () => ({ data: {} }),
  useEntityMetrics: () => ({ data: {} }),
}));
vi.mock('../services/chat', () => ({
  getPlatformChatResponse: vi.fn().mockResolvedValue('mock reply'),
}));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const { default: DataCopilotPanel, AskAiFab } = await import('../dashboard/overlay/DataCopilotPanel');

// Mirrors DashboardShell.jsx's / AdminDashboardShell.jsx's DashboardContent /
// AdminDashboardContent wiring verbatim (see those files' `askAiRef` +
// `closeCopilot`), plus two stand-ins for "background sidebar buttons" that
// a broken trap would let focus escape into.
function Harness({ scope = 'distributor' }) {
  const [open, setOpen] = React.useState(true);
  const askAiRef = React.useRef(null);
  const closeCopilot = React.useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => askAiRef.current?.focus());
  }, []);
  return (
    <div>
      <button data-testid="sidebar-overview">Overview</button>
      <button data-testid="sidebar-branches">Branches</button>
      <AskAiFab ref={askAiRef} onClick={() => setOpen(true)} active={open} />
      {open && <DataCopilotPanel open scope={scope} onClose={closeCopilot} />}
    </div>
  );
}

async function settle() {
  // Flushes the input's requestAnimationFrame-deferred autofocus-on-open.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe.each([
  ['distributor', 'Network Copilot'],
  ['admin', 'Platform Copilot'],
])('AUDIT A19-005/A19-006/A19-007 — DataCopilotPanel (%s scope)', (scope, title) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a self-consistent modal contract: aria-modal="true" is backed by an actual Tab trap', async () => {
    const user = userEvent.setup();
    render(<Harness scope={scope} />);
    await settle();

    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const closeBtn = screen.getByRole('button', { name: 'Close AI assistant' });
    const input = screen.getByRole('textbox');

    // Tab from the last enabled focusable (Send is disabled while the
    // composer is empty, so it is excluded from the focusable set — the
    // message input is genuinely last) wraps to the first (Close), and never
    // reaches the sidebar buttons rendered outside the dialog.
    input.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeBtn);
    expect(document.activeElement).not.toBe(screen.getByTestId('sidebar-overview'));
    expect(document.activeElement).not.toBe(screen.getByTestId('sidebar-branches'));
  });

  it('Shift+Tab from the first focusable (Close) wraps to the last, not out to the background', async () => {
    const user = userEvent.setup();
    render(<Harness scope={scope} />);
    await settle();

    const closeBtn = screen.getByRole('button', { name: 'Close AI assistant' });
    closeBtn.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(document.activeElement).not.toBe(screen.getByTestId('sidebar-overview'));
  });

  it('restores focus to the Ask-AI trigger when the Copilot closes via Escape', async () => {
    render(<Harness scope={scope} />);
    await settle();

    const trigger = screen.getByRole('button', { name: 'Ask AI' });
    const dialog = screen.getByRole('dialog', { name: title });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the Ask-AI trigger when the Copilot closes via the Close button', async () => {
    render(<Harness scope={scope} />);
    await settle();

    const trigger = screen.getByRole('button', { name: 'Ask AI' });
    fireEvent.click(screen.getByRole('button', { name: 'Close AI assistant' }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('AUDIT A17-005: the trigger renders the solid-fill "active" state only while the Copilot is open', async () => {
    render(<Harness scope={scope} />);
    await settle();
    const trigger = screen.getByRole('button', { name: 'Ask AI' });
    // Reflects the state to AT users too, not just sighted ones via CSS.
    expect(trigger.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close AI assistant' }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(trigger.getAttribute('aria-pressed')).toBe('false');
  });
});
