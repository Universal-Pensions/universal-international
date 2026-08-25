// AUDIT A19-001 — "Refresh loses the current view on distributor + admin
// desktop (reverts to overview)". DashboardPanelContext.jsx / AdminPanelContext.jsx
// now mirror the active rail destination (and, for admin, the Needs-attention
// drill signal) to sessionStorage and restore it via a lazy useState initializer
// on the next mount, instead of the URL — see DashboardPanelContext.jsx's header
// comment for why the URL was rejected (CLAUDE.md §4.2 keeps this shell's panel
// state intentionally unrouted, and DashboardNavContext.jsx's own navigate()
// calls strip search params on every drill/rail click).
//
// This file exercises the CONTEXT layer directly (a lightweight consumer
// component, not the full heavy shells — those get their own mode-persistence
// coverage in DashboardShell.test.jsx / AdminDashboardShell.test.jsx) so the
// role-gating and the admin attentionType encoding can be tested precisely
// without mounting Leaflet/Sidebar/the map chrome.
//
// "Refresh" is simulated as unmount() + a fresh render() with the SAME jsdom
// window — sessionStorage genuinely survives that, unlike React state, which
// is exactly the distinction this fix relies on.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ role: 'distributor' }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: mocks.role }) }));

const { DashboardProvider, useDashboard } = await import('../contexts/DashboardContext');
const { AdminPanelProvider, useAdminPanel } = await import('../contexts/AdminPanelContext');

function DistributorPanelHarness() {
  const {
    commissionsOpen, setCommissionsOpen,
    viewReportsOpen, setViewReportsOpen,
    settingsOpen, setSettingsOpen,
    closeAllPanels,
  } = useDashboard();
  const active = commissionsOpen ? 'commissions' : viewReportsOpen ? 'reports' : settingsOpen ? 'settings' : 'overview';
  return (
    <div>
      <button onClick={() => setCommissionsOpen(true)}>open-commissions</button>
      <button onClick={() => setViewReportsOpen(true)}>open-reports</button>
      <button onClick={() => setSettingsOpen(true)}>open-settings</button>
      <button onClick={closeAllPanels}>close-all</button>
      <div data-testid="active-panel">{active}</div>
    </div>
  );
}

function renderDistributorHarness() {
  return render(
    <MemoryRouter>
      <DashboardProvider>
        <DistributorPanelHarness />
      </DashboardProvider>
    </MemoryRouter>,
  );
}

function AdminPanelHarness() {
  const {
    viewDistributorsOpen, setViewDistributorsOpen,
    viewEmployersOpen, setViewEmployersOpen,
    attentionType, setAttentionType,
    closeAllPanels,
  } = useAdminPanel();
  const active = attentionType
    ? `attention:${attentionType}`
    : viewDistributorsOpen ? 'distributors' : viewEmployersOpen ? 'employers' : 'overview';
  return (
    <div>
      <button onClick={() => setViewDistributorsOpen(true)}>open-distributors</button>
      <button onClick={() => setViewEmployersOpen(true)}>open-employers</button>
      <button onClick={() => setAttentionType('contribution-lapse')}>open-attention</button>
      <button onClick={closeAllPanels}>close-all</button>
      <div data-testid="active-panel">{active}</div>
    </div>
  );
}

// AdminPanelProvider has no dependency on DashboardProvider/Router/Auth — it
// is fully self-contained (verified by reading the source: no useDashboard /
// useDashboardNav / useAuth calls anywhere in it).
function renderAdminHarness() {
  return render(
    <AdminPanelProvider>
      <AdminPanelHarness />
    </AdminPanelProvider>,
  );
}

describe('AUDIT A19-001 — session-persisted rail destination', () => {
  beforeEach(() => {
    mocks.role = 'distributor';
    try { window.sessionStorage.clear(); } catch { /* private-browsing */ }
  });

  describe('DashboardPanelContext (distributor + shared panels)', () => {
    it('restores the active panel on a fresh mount after it was left open', () => {
      const { unmount } = renderDistributorHarness();
      fireEvent.click(screen.getByText('open-commissions'));
      expect(screen.getByTestId('active-panel').textContent).toBe('commissions');
      unmount();

      renderDistributorHarness();
      // Restored on the very first render (lazy useState init) — no
      // Overview-then-flip flash.
      expect(screen.getByTestId('active-panel').textContent).toBe('commissions');
    });

    it('overwrites the persisted panel when the user switches to a different one', () => {
      const { unmount } = renderDistributorHarness();
      fireEvent.click(screen.getByText('open-commissions'));
      fireEvent.click(screen.getByText('open-reports'));
      unmount();

      renderDistributorHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('reports');
    });

    it('clears the persisted panel once the user returns to Overview, so a later reload shows Overview too', () => {
      const { unmount } = renderDistributorHarness();
      fireEvent.click(screen.getByText('open-settings'));
      fireEvent.click(screen.getByText('close-all'));
      unmount();

      renderDistributorHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('overview');
    });

    it('does not persist anything for roles outside the distributor/admin gate (e.g. branch)', () => {
      mocks.role = 'branch';
      const { unmount } = renderDistributorHarness();
      fireEvent.click(screen.getByText('open-commissions'));
      // Still opens correctly THIS session — the gate only affects persistence.
      expect(screen.getByTestId('active-panel').textContent).toBe('commissions');
      unmount();

      renderDistributorHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('overview');
      expect(window.sessionStorage.getItem('upensions_branch_panel')).toBeNull();
    });

    it('keys distributor and admin sessions separately, so one role cannot rehydrate the other\'s last panel', () => {
      const { unmount } = renderDistributorHarness();
      fireEvent.click(screen.getByText('open-commissions'));
      unmount();

      mocks.role = 'admin';
      renderDistributorHarness();
      // 'commissions' was written under upensions_distributor_panel; the admin
      // instance reads upensions_admin_panel, which is untouched.
      expect(screen.getByTestId('active-panel').textContent).toBe('overview');
    });
  });

  describe('AdminPanelContext (admin-exclusive panels + Needs-attention drill)', () => {
    it('restores an admin-exclusive panel (Distributors) on a fresh mount', () => {
      const { unmount } = renderAdminHarness();
      fireEvent.click(screen.getByText('open-distributors'));
      unmount();

      renderAdminHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('distributors');
    });

    it('restores the Needs-attention drill by signal id, not just "attention is open"', () => {
      const { unmount } = renderAdminHarness();
      fireEvent.click(screen.getByText('open-attention'));
      expect(screen.getByTestId('active-panel').textContent).toBe('attention:contribution-lapse');
      unmount();

      renderAdminHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('attention:contribution-lapse');
    });

    it('clears on closeAllPanels so a later reload does not resurrect a closed panel', () => {
      const { unmount } = renderAdminHarness();
      fireEvent.click(screen.getByText('open-employers'));
      fireEvent.click(screen.getByText('close-all'));
      unmount();

      renderAdminHarness();
      expect(screen.getByTestId('active-panel').textContent).toBe('overview');
    });
  });
});
