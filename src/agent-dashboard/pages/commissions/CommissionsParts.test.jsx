// Regression coverage for A05-002 / A11-001 (contradictory outstanding-balance
// figures on the agent Commissions screen) and A05-010 (raw batch UUID shown
// instead of the human payment reference).
//
// SettlementMismatchBanner renders the shortfall from ONE past settlement
// batch (frozen at settlement time); the Owed/Outstanding tile that follows
// it on both CommissionsPage.jsx (mobile) and CommissionsDesktop.jsx renders
// the agent's LIVE due total. Both numbers are independently correct — the
// bug was presenting them side by side with no label explaining why they
// differ. These tests pin the banner's copy to explicitly scope its figure
// to "that settlement" / "right now", and pin the reference it displays to
// the human txnRef rather than the internal batch id.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettlementMismatchBanner } from './CommissionsParts';
import { commissionsErrorMessage } from './commissionsConfig';

const RAW_UUID = 'sb-09258a3b9cc94064be51e0a6f0a04fa5';
const HUMAN_REF = 'MM-SEED-0001';

describe('SettlementMismatchBanner', () => {
  it('renders nothing when there is no partial batch', () => {
    const { container } = render(<SettlementMismatchBanner batch={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the shortfall as scoped to that settlement, distinct from the live "right now" tile (A05-002 / A11-001)', () => {
    render(
      <SettlementMismatchBanner
        batch={{ id: RAW_UUID, txnRef: HUMAN_REF, pendingTotal: 20000, paidAmount: 5000, paidDate: '2026-08-03' }}
      />,
    );

    // The figure is explicitly tied to "that settlement" — not phrased as a
    // bare, unscoped "outstanding" that could be read as the live total.
    expect(screen.getByText(/from that settlement is still unpaid/i)).toBeInTheDocument();
    // It also explicitly disclaims the live figure shown right after it, so a
    // non-technical reader isn't left to reconcile two numbers on their own.
    expect(screen.getByText(/separate from what's owed to you right now/i)).toBeInTheDocument();

    // Arithmetic still holds: 20,000 - 5,000 = 15,000 (formatUGX compacts to "15K").
    expect(screen.getByText(/UGX 15K/)).toBeInTheDocument();
  });

  it('shows the human payment reference, never the internal batch UUID (A05-010)', () => {
    render(
      <SettlementMismatchBanner
        batch={{ id: RAW_UUID, txnRef: HUMAN_REF, pendingTotal: 20000, paidAmount: 5000 }}
      />,
    );

    expect(screen.getByText(new RegExp(`ref ${HUMAN_REF}\\)`))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(RAW_UUID))).not.toBeInTheDocument();

    // The "Ask for reason" mailto must carry the same human reference, not
    // the UUID, since back-office staff would have to translate it either way.
    const link = screen.getByRole('link', { name: /ask for reason/i });
    const href = link.getAttribute('href');
    expect(href).toContain(encodeURIComponent(HUMAN_REF));
    expect(href).not.toContain(RAW_UUID);
  });

  it('falls back to batch.id only when txnRef is missing', () => {
    render(
      <SettlementMismatchBanner
        batch={{ id: RAW_UUID, txnRef: null, pendingTotal: 10000, paidAmount: 5000 }}
      />,
    );

    expect(screen.getByText(new RegExp(`ref ${RAW_UUID}\\)`))).toBeInTheDocument();
  });
});

// A11-008 — the commissions error card rendered the raw string
// "TypeError: Failed to fetch" to field agents. commissionsErrorMessage() is
// the mapper that must sit between the thrown error and <ErrorCard message>.
describe('commissionsErrorMessage (A11-008)', () => {
  // The exact value observed in the audit repro: services/commissions.js
  // _rpcError copies supabase-js's message verbatim for a failed fetch.
  const OBSERVED = Object.assign(new Error('TypeError: Failed to fetch'), { code: 'rpc_error' });

  it('never leaks a JavaScript exception string', () => {
    for (const input of [
      OBSERVED,
      new Error('TypeError: Failed to fetch'),
      'TypeError: Failed to fetch',
      new Error("Cannot read properties of undefined (reading 'map')"),
      Object.assign(new Error('boom'), { code: 'rpc_error' }),
      null,
      undefined,
      {},
    ]) {
      const out = commissionsErrorMessage(input);
      expect(out).not.toMatch(/TypeError|undefined|Error:|\bnull\b|properties of/);
      expect(out).toMatch(/^[A-Z].*\.$/); // a real sentence, not a fragment
    }
  });

  it('tells the agent to check the connection when the request never landed', () => {
    const expected = 'We could not reach the server. Check your internet connection and try again.';
    expect(commissionsErrorMessage(OBSERVED)).toBe(expected);
    expect(commissionsErrorMessage(new Error('NetworkError when attempting to fetch resource.'))).toBe(expected);
    expect(commissionsErrorMessage(new Error('Load failed'))).toBe(expected);
    expect(commissionsErrorMessage(Object.assign(new Error('x'), { code: 'network_unreachable' }))).toBe(expected);
    expect(commissionsErrorMessage(Object.assign(new Error('x'), { code: 'timeout' }))).toBe(expected);
    expect(commissionsErrorMessage(Object.assign(new Error('x'), { code: 'server_unavailable' }))).toBe(expected);
  });

  it('tells the agent to sign in again when the session has expired', () => {
    const expected = 'Your sign-in has ended. Please sign in again.';
    expect(commissionsErrorMessage(Object.assign(new Error('Session expired'), { code: 'session_expired' }))).toBe(expected);
    expect(commissionsErrorMessage(Object.assign(new Error('JWT expired'), { status: 401 }))).toBe(expected);
  });

  it('falls back to a fixed sentence for anything unrecognised', () => {
    const expected = 'Something went wrong on our side. Please try again in a moment.';
    expect(commissionsErrorMessage(Object.assign(new Error('duplicate key value'), { code: '23505' }))).toBe(expected);
    expect(commissionsErrorMessage(undefined)).toBe(expected);
    expect(commissionsErrorMessage('')).toBe(expected);
  });

  it('uses plain language — no jargon a field agent would not recognise', () => {
    const all = [
      commissionsErrorMessage(OBSERVED),
      commissionsErrorMessage(Object.assign(new Error('x'), { code: 'session_expired' })),
      commissionsErrorMessage(new Error('anything else')),
    ];
    for (const msg of all) {
      expect(msg).not.toMatch(/token|JWT|RPC|API|HTTP|fetch|500|401|null|payload|exception/i);
    }
  });
});
