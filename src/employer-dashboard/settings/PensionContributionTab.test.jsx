// RTL tests for the employer Settings → Pension contribution tab.
//
// This tab had NO component test before migration 0093, which is how it kept
// four controls (two flat-vs-percent radio pairs) that no employer had ever used
// and that no assertion described. The tab now asks the question employers
// actually answer — WHO contributes — and then one percentage per participating
// side.
//
// THE INVARIANT WORTH PINNING. "Who contributes?" is UI state DERIVED from the
// two stored percentages; it is never persisted as its own key. Re-introducing a
// stored discriminator would recreate the `mode` field that 0092 spent 835 lines
// removing, along with its stale-key hazard. Two consequences, both tested here:
//
//   * On load, the selector is derived: a config with employeePct 0 opens on
//     "Company only" without anything in the row saying so.
//   * On save, the EXCLUDED leg is forced to 0 no matter what the draft holds —
//     otherwise a stale figure on the hidden side would make the next load
//     derive the wrong selection. The draft still keeps the typed value so
//     toggling back and forth doesn't lose the employer's number; only the
//     persisted object is zeroed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsBody, PensionContributionTab } from './settingsTabs';

// SettingsBody owns the draft + the atomic saveConfig seam; the tab is
// presentational over its slice. Mount them together so the derivation on seed
// and the zeroing on save are both exercised through the real seam.
const mutate = vi.fn();

vi.mock('../../hooks/useEmployer', () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
  useUpdateEmployerProfile: () => ({ mutate, isPending: false }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'emp-001', role: 'employer' } }),
}));

beforeEach(() => mutate.mockReset());

function renderTab(defaultContributionConfig) {
  return render(
    <SettingsBody
      tab="pension"
      settingsOpen
      employer={{ id: 'emp-001', name: 'Nile Breweries Ltd', defaultContributionConfig }}
      employerId="emp-001"
      addToast={() => {}}
      render={({ tabs }) => tabs.pension}
    />,
  );
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
const savedConfig = () => mutate.mock.calls[0][0].defaultContributionConfig;
const whoRadio = (name) => screen.getByRole('radio', { name });
const staffField = () => screen.queryByLabelText(/share of each person's pay \(%\)/i);
const companyField = () => screen.queryByLabelText(/share of each person's pay you add \(%\)/i);

// ---------------------------------------------------------------------------
// Deriving the selector from what is stored
// ---------------------------------------------------------------------------
describe('“Who contributes?” is derived from the two percentages', () => {
  it('opens on “Staff and company” when both legs fund something', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    expect(whoRadio(/staff and company/i)).toBeChecked();
    expect(staffField()).toHaveValue(10);
    expect(companyField()).toHaveValue(5);
  });

  it('opens on “Staff only” when the company leg is zero, and hides the company field', () => {
    renderTab({ employeePct: 10, employerPct: 0 });
    expect(whoRadio(/staff only/i)).toBeChecked();
    expect(staffField()).toBeInTheDocument();
    expect(companyField()).not.toBeInTheDocument();
  });

  it('opens on “Company only” when the staff leg is zero, and hides the staff field', () => {
    renderTab({ employeePct: 0, employerPct: 5 });
    expect(whoRadio(/company only/i)).toBeChecked();
    expect(companyField()).toBeInTheDocument();
    expect(staffField()).not.toBeInTheDocument();
  });

  // A brand-new employer is provisioned with '{}', which derives to 'none'.
  // Opening on a fourth "nothing" state would just be a click to get out of.
  it('opens an unconfigured employer on “Staff and company”', () => {
    renderTab({});
    expect(whoRadio(/staff and company/i)).toBeChecked();
  });

  it('derives through a legacy pre-0092 config too', () => {
    renderTab({ mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 });
    expect(whoRadio(/staff and company/i)).toBeChecked();
    expect(companyField()).toHaveValue(5); // 10% × 50% match === 5% of pay
  });
});

// ---------------------------------------------------------------------------
// What actually gets saved
// ---------------------------------------------------------------------------
describe('saving writes the percent-only shape', () => {
  it('sends both percentages and none of the deleted keys', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    save();
    const cfg = savedConfig();
    expect(cfg).toMatchObject({ employeePct: 10, employerPct: 5 });
    for (const dead of ['mode', 'employerMatchPct', 'matchPct',
      'employeeBasis', 'employerBasis', 'employeeAmount', 'employerAmount']) {
      expect(cfg).not.toHaveProperty(dead);
    }
  });

  it('forces the staff leg to 0 under “Company only”', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.click(whoRadio(/company only/i));
    save();
    expect(savedConfig()).toMatchObject({ employeePct: 0, employerPct: 5 });
  });

  it('forces the company leg to 0 under “Staff only”', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.click(whoRadio(/staff only/i));
    save();
    expect(savedConfig()).toMatchObject({ employeePct: 10, employerPct: 0 });
  });

  // The round trip that would break if `who` were stored instead of derived.
  it('a saved “Company only” config re-opens on “Company only”', () => {
    const { unmount } = renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.click(whoRadio(/company only/i));
    save();
    const persisted = savedConfig();
    unmount();

    renderTab(persisted);
    expect(whoRadio(/company only/i)).toBeChecked();
  });

  it('keeps the group-insurance keys on the same save', () => {
    renderTab({
      employeePct: 10,
      employerPct: 5,
      insuranceEnabled: true,
      groupCoverAmount: 15000000,
      groupInsuranceProducts: { life: { enabled: true, cover: 15000000 } },
    });
    save();
    const cfg = savedConfig();
    expect(cfg.insuranceEnabled).toBe(true);
    expect(cfg.groupCoverAmount).toBe(15000000);
    expect(cfg.groupInsuranceProducts.life).toMatchObject({ enabled: true, cover: 15000000 });
  });
});

// ---------------------------------------------------------------------------
// The hidden side keeps its figure
// ---------------------------------------------------------------------------
describe('toggling who contributes does not lose a typed figure', () => {
  it('restores the staff percentage when switching back from “Company only”', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.click(whoRadio(/company only/i));
    expect(staffField()).not.toBeInTheDocument();

    fireEvent.click(whoRadio(/staff and company/i));
    expect(staffField()).toHaveValue(10);
  });
});

// ---------------------------------------------------------------------------
// Validation + the 0/0 warning
// ---------------------------------------------------------------------------
describe('validation', () => {
  it('rejects a percentage above 100 on a participating leg', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.change(staffField(), { target: { value: '150' } });
    save();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/from 0 to 100/i);
  });

  // A leg that is hidden must never be able to block the save — the Insurance tab
  // submits this same handler over this same draft.
  it('ignores an out-of-range figure on a leg that is not participating', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.change(staffField(), { target: { value: '150' } });
    fireEvent.click(whoRadio(/company only/i));
    save();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(savedConfig()).toMatchObject({ employeePct: 0, employerPct: 5 });
  });

  // 0/0 is legal: it funds no pension, and the employer is told rather than
  // stopped. Never a block, never a confirm dialog.
  it('saves a 0/0 configuration and flags it', () => {
    renderTab({ employeePct: 0, employerPct: 0 });
    save();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(savedConfig()).toMatchObject({ employeePct: 0, employerPct: 0 });
    expect(screen.getByText(/nothing is going into pensions/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The preview must agree with what will be saved
// ---------------------------------------------------------------------------
describe('the worked example matches what gets saved', () => {
  it('shows both legs for a UGX 1,000,000 member', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    expect(screen.getByText('UGX 100,000')).toBeInTheDocument();
    expect(screen.getByText('UGX 50,000')).toBeInTheDocument();
    expect(screen.getByText('UGX 150,000')).toBeInTheDocument();
  });

  // The preview zeroes the excluded side exactly as saveConfig does, so the
  // employer is never shown money that the save is about to discard.
  it('drops the staff line as soon as “Company only” is picked', () => {
    renderTab({ employeePct: 10, employerPct: 5 });
    fireEvent.click(whoRadio(/company only/i));
    expect(screen.queryByText('UGX 100,000')).not.toBeInTheDocument();
    expect(screen.getAllByText('UGX 50,000').length).toBeGreaterThan(0);
  });
});
