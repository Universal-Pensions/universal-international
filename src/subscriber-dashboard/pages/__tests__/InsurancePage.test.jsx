// InsurancePage — renders the subscriber life-cover surface across states.
//
// Pure render/smoke coverage: every data hook and the ToastContext are stubbed
// so no network / Supabase / TanStack Query is touched. We drive the component
// through three shapes — a populated policy on mobile, the same on desktop, and
// the still-loading (sub === undefined) empty state — asserting on stable
// headings, the beneficiary count, and the exact cover figure (computed via the
// real formatUGX util so the assertion stays truthful if formatting changes).

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { formatUGX } from '../../../utils/currency';

// ── Hoisted mock fns so the vi.mock factories can close over them. ────────────
const { mockUseCurrentSubscriber, mockUseIsDesktop } = vi.hoisted(() => ({
  mockUseCurrentSubscriber: vi.fn(),
  mockUseIsDesktop: vi.fn(),
}));

vi.mock('../../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: () => mockUseCurrentSubscriber(),
  // Mutations are only exercised on click; the component reads .mutateAsync /
  // .isPending, so provide the standard TanStack mutation surface.
  useUpdateInsuranceCover: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useFundInsuranceProducts: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('../../../hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

import InsurancePage from '../InsurancePage';

const COVER = 2_000_000; // matches a COVER_TIERS row → "Current cover" button state

function makeSubscriber() {
  return {
    id: 'sub-001',
    insurance: {
      cover: COVER,
      premiumMonthly: 3500,
      renewalDate: '2027-01-15',
      policyStart: '2026-01-15',
    },
    policies: [
      { type: 'life', cover: COVER, status: 'active', name: 'Life cover', renewalDate: '2027-01-15' },
    ],
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

beforeEach(() => {
  mockUseIsDesktop.mockReturnValue(false);
  mockUseCurrentSubscriber.mockReturnValue({ data: makeSubscriber() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InsurancePage', () => {
  it('renders the active policy on mobile with cover, upgrade picker and beneficiaries', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderPage();

    // Mobile summary card + the upgrade picker heading (present because a policy
    // is active, so it is the "Upgrade" wording rather than "Pick your cover").
    // "Current cover" appears twice: the summary eyebrow and the disabled CTA
    // (the selected tier equals the active cover).
    expect(screen.getAllByText('Current cover').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Upgrade your cover')).toBeInTheDocument();

    // The exact cover figure the summary renders (full, non-compact form).
    const coverFigure = formatUGX(COVER, { compact: false });
    expect(screen.getAllByText(coverFigure).length).toBeGreaterThanOrEqual(1);

    // Beneficiaries section is populated from nominees.insurance.
    expect(screen.getByText('Insurance beneficiaries')).toBeInTheDocument();
    expect(screen.getByText('1 on file')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('File a claim')).toBeInTheDocument();
  });

  it('renders the desktop split with the PageHeader and "Your cover" summary', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderPage();

    // Desktop-only PageHeader title + subtitle.
    expect(screen.getByText('Insurance cover')).toBeInTheDocument();
    expect(screen.getByText('Premium and policy level')).toBeInTheDocument();

    // The sticky right-column summary card.
    expect(screen.getByText('Your cover')).toBeInTheDocument();
    expect(screen.getByText('Upgrade your cover')).toBeInTheDocument();

    const coverFigure = formatUGX(COVER, { compact: false });
    expect(screen.getAllByText(coverFigure).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty / still-loading state (sub undefined) without crashing', () => {
    mockUseCurrentSubscriber.mockReturnValue({ data: undefined });
    mockUseIsDesktop.mockReturnValue(false);
    renderPage();

    // No active policy → empty-cover card + first-time "Pick your cover" picker.
    // ("Pick your cover" renders twice: the empty-card CTA and the picker title.)
    expect(screen.getByText('No active policy')).toBeInTheDocument();
    expect(screen.getAllByText('Pick your cover').length).toBeGreaterThanOrEqual(1);
    // Beneficiaries section still renders with a zero count, and no crash.
    expect(screen.getByText('0 on file')).toBeInTheDocument();
  });
});
