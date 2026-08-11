// InsurancePage — the subscriber's per-product cover surface.
//
// Every data hook and the ToastContext are stubbed so no network / Supabase /
// TanStack Query is touched. The page sells THREE products (life, health,
// funeral), each with its own cover ladder, so the assertions here are mostly
// about the segmented product selector correctly retargeting the slider, the
// CTA, the pay sheet and the summary — the thing that was impossible before,
// when the whole page was hardcoded to life.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { formatUGX } from '../../../utils/currency';

// ── Hoisted mock fns so the vi.mock factories can close over them. ────────────
const {
  mockUseCurrentSubscriber, mockUseIsDesktop, mockUpdateCover, mockFundProducts, mockAddToast,
} = vi.hoisted(() => ({
  mockUseCurrentSubscriber: vi.fn(),
  mockUseIsDesktop: vi.fn(),
  mockUpdateCover: vi.fn(),
  mockFundProducts: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: () => mockUseCurrentSubscriber(),
  // Mutations are only exercised on click; the component reads .mutateAsync /
  // .isPending, so provide the standard TanStack mutation surface.
  useUpdateInsuranceCover: () => ({ mutate: vi.fn(), mutateAsync: mockUpdateCover, isPending: false }),
  useFundInsuranceProducts: () => ({ mutate: vi.fn(), mutateAsync: mockFundProducts, isPending: false }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('../../../hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

import InsurancePage from '../InsurancePage';

const COVER = 2_000_000; // life ladder tier 1 → the disabled "Current cover" state

const LIFE = {
  type: 'life', cover: COVER, status: 'active', name: 'Life cover',
  renewalDate: '2027-01-15', renewalAmount: 42_000,
};

function makeSubscriber(policies = [LIFE]) {
  return {
    id: 'sub-001',
    insurance: {
      cover: COVER, premiumMonthly: 3500,
      renewalDate: '2027-01-15', policyStart: '2026-01-15',
    },
    policies,
    nominees: {
      insurance: [
        { id: 'n1', name: 'Jane Doe', relationship: 'spouse', phone: '+256711000002', share: 100 },
      ],
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InsurancePage />
    </MemoryRouter>,
  );
}

/** The product segmented control. */
const segment = (name) => screen.getByRole('radio', { name: new RegExp(`^${name}`) });
const picker = (product) => screen.getByRole('group', { name: `${product} cover amount` });

beforeEach(() => {
  mockUseIsDesktop.mockReturnValue(false);
  mockUseCurrentSubscriber.mockReturnValue({ data: makeSubscriber() });
  mockUpdateCover.mockResolvedValue({});
  mockFundProducts.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InsurancePage', () => {
  it('renders the active policy on mobile with cover, upgrade picker and beneficiaries', () => {
    renderPage();

    expect(screen.getByText('Current cover')).toBeInTheDocument();
    expect(screen.getByText('Upgrade your cover')).toBeInTheDocument();
    expect(screen.getAllByText(formatUGX(COVER, { compact: false })).length).toBeGreaterThanOrEqual(1);

    // Beneficiaries section is populated from nominees.insurance.
    expect(screen.getByText('Insurance beneficiaries')).toBeInTheDocument();
    expect(screen.getByText('1 on file')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('File a claim')).toBeInTheDocument();
  });

  it('renders the desktop split with the PageHeader and "Your cover" summary', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderPage();

    expect(screen.getByText('Insurance cover')).toBeInTheDocument();
    expect(screen.getByText('Premium and policy level')).toBeInTheDocument();
    expect(screen.getByText('Your cover')).toBeInTheDocument();
    expect(screen.getByText('Upgrade your cover')).toBeInTheDocument();
  });

  it('renders the empty / still-loading state (sub undefined) without crashing', () => {
    mockUseCurrentSubscriber.mockReturnValue({ data: undefined });
    renderPage();

    expect(screen.getByText('No active cover')).toBeInTheDocument();
    expect(screen.getAllByText('Pick your cover').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0 on file')).toBeInTheDocument();
  });

  // ── The product selector ───────────────────────────────────────────────────
  describe('product selector', () => {
    it('offers all three products and shows which are held', () => {
      renderPage();
      expect(segment('Life')).toBeInTheDocument();
      expect(segment('Hospital cash')).toBeInTheDocument();
      expect(segment('Funeral')).toBeInTheDocument();

      // Held cover is shown on its segment; unheld reads as an em dash.
      expect(segment('Life')).toHaveTextContent('UGX 2.0M');
      expect(segment('Hospital cash')).toHaveTextContent('—');
    });

    it('starts on the member’s live self-funded policy', () => {
      renderPage();
      expect(segment('Life')).toBeChecked();
      expect(picker('Life')).toBeInTheDocument();
    });

    it('retargets the slider and the CTA when another product is chosen', async () => {
      const user = userEvent.setup();
      renderPage();

      // Life is held at tier 1 → the CTA is the disabled "current" state.
      expect(screen.getByRole('button', { name: /current life cover/i })).toBeDisabled();

      await user.click(segment('Hospital cash'));
      // Health isn't held, so its entry tier is a purchase, not a change.
      expect(picker('Hospital cash')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Life cover amount' })).toBeNull();
      expect(screen.getByRole('button', { name: /get UGX 3\.0M cover/i })).toBeEnabled();
    });

    it('uses the ladder belonging to the selected product', async () => {
      const user = userEvent.setup();
      renderPage();
      // Life tops out at 5M...
      expect(within(picker('Life')).getByRole('button', { name: /^UGX 5,000,000 cover/ })).toBeInTheDocument();

      await user.click(segment('Hospital cash'));
      // ...health at 12M.
      expect(within(picker('Hospital cash')).getByRole('button', { name: /^UGX 12,000,000 cover/ })).toBeInTheDocument();
    });
  });

  // ── Buying and lowering cover ──────────────────────────────────────────────
  describe('changing cover', () => {
    it('funds the SELECTED product, not life', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(segment('Funeral'));
      await user.click(within(picker('Funeral')).getByRole('button', { name: /^UGX 5,000,000 cover/ }));
      await user.click(screen.getByRole('button', { name: /get UGX 5\.0M cover/i }));

      // Opens the pay sheet; paying calls the RPC with the funeral product.
      await user.click(screen.getByRole('button', { name: /^pay /i }));
      expect(mockFundProducts).toHaveBeenCalledWith(expect.objectContaining({
        fundingMode: 'pay_now',
        products: [{ product: 'funeral', cover: 5_000_000, premiumMonthly: 3_250 }],
      }));
    });

    it('lowers the selected product’s cover behind a two-tap confirm, with no payment', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(within(picker('Life')).getByRole('button', { name: /^UGX 1,000,000 cover/ }));
      // First tap only arms the confirm.
      await user.click(screen.getByRole('button', { name: /^downgrade to/i }));
      expect(mockUpdateCover).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /^confirm downgrade to/i }));
      expect(mockUpdateCover).toHaveBeenCalledWith({
        product: 'life', cover: 1_000_000, premiumMonthly: 2_000,
      });
      // Downgrades never charge.
      expect(mockFundProducts).not.toHaveBeenCalled();
    });

    it('drops a pending downgrade confirmation when the product changes', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(within(picker('Life')).getByRole('button', { name: /^UGX 1,000,000 cover/ }));
      await user.click(screen.getByRole('button', { name: /^downgrade to/i }));
      await user.click(segment('Hospital cash'));
      await user.click(segment('Life'));

      // Back on life, the confirm must be re-armed rather than one tap from
      // committing a downgrade the member navigated away from.
      expect(screen.getByRole('button', { name: /^downgrade to/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^confirm downgrade/i })).toBeNull();
    });
  });

  // ── Per-product states ─────────────────────────────────────────────────────
  describe('non-adjustable policies', () => {
    it('shows employer-funded cover read-only, with no picker', async () => {
      const user = userEvent.setup();
      mockUseCurrentSubscriber.mockReturnValue({
        data: makeSubscriber([
          LIFE,
          { type: 'health', cover: 3_000_000, status: 'active', fundedBy: 'employer', renewalDate: '2027-02-01' },
        ]),
      });
      renderPage();

      // Life (self-funded) is the default target and keeps its picker.
      expect(picker('Life')).toBeInTheDocument();

      // Health is employer-paid — the RPC rejects a re-buy, so offer nothing.
      await user.click(segment('Hospital cash'));
      expect(screen.queryByRole('group', { name: 'Hospital cash cover amount' })).toBeNull();
      expect(screen.getByText(/paid for by your employer/i)).toBeInTheDocument();
    });

    // A BUILDING policy keeps its cover amount read-only — "pay off my build
    // early" is a different decision from "change my cover" — but the PACE is
    // adjustable here. That control used to live on the schedule page behind a
    // link to `/dashboard/schedule`, a route that never existed; it moved here
    // when cover editing was consolidated onto this page.
    describe('a building policy', () => {
      const BUILDING = {
        type: 'funeral', cover: 2_000_000, status: 'building', renewalDate: '2027-03-01',
      };
      const paceSlider = () => screen.getByRole('slider', {
        name: /percent of liquid savings that builds cover/i,
      });

      function renderBuilding(insuranceSavingsPct = 40) {
        mockUseCurrentSubscriber.mockReturnValue({
          data: {
            ...makeSubscriber([LIFE, BUILDING]),
            contributionSchedule: { insuranceSavingsPct },
          },
        });
        renderPage();
      }

      it('keeps the cover amount read-only', async () => {
        const user = userEvent.setup();
        renderBuilding();
        await user.click(segment('Funeral'));

        expect(screen.queryByRole('group', { name: 'Funeral cover amount' })).toBeNull();
        expect(screen.getByText(/still\s+building/i)).toBeInTheDocument();
      });

      it('seeds the build speed from the stored schedule and gates save until it changes', async () => {
        const user = userEvent.setup();
        renderBuilding(40);
        await user.click(segment('Funeral'));

        expect(paceSlider()).toHaveValue('40');
        // Nothing to save yet — the guard that stops a no-op RPC round trip.
        expect(screen.getByRole('button', { name: /no changes to save/i })).toBeDisabled();
      });

      it('saves the new pace WITHOUT buying anything', async () => {
        const user = userEvent.setup();
        renderBuilding(40);
        await user.click(segment('Funeral'));

        // jsdom has no pointer geometry for a range input, so drive it by value.
        fireEvent.change(paceSlider(), { target: { value: '65' } });
        await user.click(screen.getByRole('button', { name: /save build speed/i }));

        expect(mockFundProducts).toHaveBeenCalledTimes(1);
        const call = mockFundProducts.mock.calls[0][0];
        // The whole point: an EMPTY product list writes the funding columns and
        // charges nothing. A non-empty list here would activate cover and bill a
        // full year's premium off a slider drag.
        expect(call).toMatchObject({ fundingMode: 'save_to_cover', products: [], savingsPct: 65 });
        expect(call.nonce).toEqual(expect.any(String));
      });

      it('warns when the pace is zero, because the cover would never finish', async () => {
        const user = userEvent.setup();
        renderBuilding(40);
        await user.click(segment('Funeral'));

        fireEvent.change(paceSlider(), { target: { value: '0' } });
        expect(screen.getByText(/will not finish building/i)).toBeInTheDocument();
      });
    });
  });

  // ── Desktop composition ────────────────────────────────────────────────────
  // The desktop page has a hard no-scroll budget, so it composes the same blocks
  // differently from mobile: no duplicate empty-cover card, a shorter nominee
  // list, and "File a claim" folded into the beneficiaries action row.
  describe('desktop composition', () => {
    beforeEach(() => { mockUseIsDesktop.mockReturnValue(true); });

    it('drops the empty-cover card because the rail already says it', () => {
      mockUseCurrentSubscriber.mockReturnValue({ data: makeSubscriber([]) });
      renderPage();
      // The rail card is the single source of the no-cover message...
      expect(screen.getByText('No active cover')).toBeInTheDocument();
      // ...and the left column's duplicate (with its scroll-to-picker CTA that
      // pointed at a picker already on screen) is gone.
      expect(screen.queryByRole('button', { name: /^pick your cover$/i })).toBeNull();
    });

    it('keeps "File a claim" reachable — it moved into the action row, it did not die', () => {
      renderPage();
      expect(screen.getByText('File a claim')).toBeInTheDocument();
    });

    it('caps the beneficiary list at two while still reporting the true count', () => {
      const many = makeSubscriber();
      many.nominees.insurance = [
        { id: 'n1', name: 'Jane Doe', relationship: 'spouse', phone: '+256711000002', share: 40 },
        { id: 'n2', name: 'Peter Okot', relationship: 'child', phone: '+256711000003', share: 30 },
        { id: 'n3', name: 'Mary Achan', relationship: 'parent', phone: '+256711000004', share: 30 },
      ];
      mockUseCurrentSubscriber.mockReturnValue({ data: many });
      renderPage();

      expect(screen.getByText('3 on file')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Peter Okot')).toBeInTheDocument();
      expect(screen.queryByText('Mary Achan')).toBeNull();
    });

    it('still shows all three on mobile, where there is no budget pressure', () => {
      mockUseIsDesktop.mockReturnValue(false);
      const many = makeSubscriber();
      many.nominees.insurance = [
        { id: 'n1', name: 'Jane Doe', relationship: 'spouse', phone: '+256711000002', share: 40 },
        { id: 'n2', name: 'Peter Okot', relationship: 'child', phone: '+256711000003', share: 30 },
        { id: 'n3', name: 'Mary Achan', relationship: 'parent', phone: '+256711000004', share: 30 },
      ];
      mockUseCurrentSubscriber.mockReturnValue({ data: many });
      renderPage();
      expect(screen.getByText('Mary Achan')).toBeInTheDocument();
    });
  });

  // ── Hospital cash daily payout ─────────────────────────────────────────────
  // Hospital cash pays per NIGHT, so the cover figure alone overstates what the
  // member actually receives on any given day. The daily line is what makes the
  // product legible.
  describe('hospital cash daily benefit', () => {
    it('states the daily payout and tracks the chosen tier', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(segment('Hospital cash'));

      // Entry tier: 3,000,000 ÷ 20 = 150,000 a day.
      expect(screen.getByText(/daily/)).toHaveTextContent(
        'You will be paid UGX 150,000 daily for 20 days of hospitalisation.',
      );

      await user.click(within(picker('Hospital cash')).getByRole('button', { name: /^UGX 12,000,000 cover/ }));
      expect(screen.getByText(/daily/)).toHaveTextContent('UGX 600,000 daily');
    });

    it('is not shown for lump-sum products', () => {
      renderPage(); // defaults to life
      expect(screen.queryByText(/days of hospitalisation/)).toBeNull();
    });

    it('is shown for employer-funded hospital cash too', async () => {
      const user = userEvent.setup();
      mockUseCurrentSubscriber.mockReturnValue({
        data: makeSubscriber([
          LIFE,
          { type: 'health', cover: 8_000_000, status: 'active', fundedBy: 'employer', renewalDate: '2027-02-01' },
        ]),
      });
      renderPage();
      await user.click(segment('Hospital cash'));
      // No picker here, but the member still needs to know their daily payout.
      expect(screen.getByText(/daily/)).toHaveTextContent('UGX 400,000 daily');
    });
  });

  // ── Summaries ──────────────────────────────────────────────────────────────
  it('totals cover across every active policy, not just life', () => {
    mockUseCurrentSubscriber.mockReturnValue({
      data: makeSubscriber([
        LIFE,
        { type: 'health', cover: 3_000_000, status: 'active', renewalDate: '2027-02-01', renewalAmount: 60_000 },
      ]),
    });
    renderPage();

    // 2M life + 3M health = 5M. Reading sub.insurance.cover alone would say 2M.
    expect(screen.getByText('UGX 5,000,000')).toBeInTheDocument();
    expect(screen.getByText(/Life & Hospital cash/)).toBeInTheDocument();
  });
});
