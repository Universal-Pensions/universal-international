// ActivatedStep — insurance certificate download failure surfaces via the
// app's own toast, not a blocking window.alert (A24-001).
//
// Regression cover: openPolicyCertificate() used to return `false` on EVERY
// call (see insurancePolicyCertificate.test.js — A24-001), and this step's
// failure branch called window.alert(), a blocking native dialog that reads
// as a browser-chrome error rather than part of the product and stalls the
// whole tab until dismissed. The fix routes the exact same failure through
// useToast()/addToast() — the identical pattern the sibling call site
// (PoliciesPage.jsx handleCertificate) already used for this exact message.
// This pins two things: window.alert is never invoked, and the member still
// sees the message, through the app's own in-page messaging.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupProvider } from '../../SignupContext';
import { ToastProvider } from '../../../contexts/ToastContext';
import ToastContainer from '../../../components/Toast';
import ActivatedStep from '../ActivatedStep';

const openPolicyCertificate = vi.fn();
vi.mock('../../contribution/insurancePolicyCertificate', () => ({
  openPolicyCertificate: (...args) => openPolicyCertificate(...args),
}));

const snapshot = {
  fullName: 'Asha Namubiru',
  phone: '+256711000001',
  dob: '1990-01-01',
  gender: 'female',
  contributionSchedule: {
    insuranceFundingMode: 'pay_now',
    insuranceTypes: ['life'],
  },
  insuranceBeneficiaries: [],
};

function renderStep() {
  return render(
    <SignupProvider>
      <ToastProvider>
        <ActivatedStep snapshot={snapshot} onFinish={() => {}} />
        <ToastContainer />
      </ToastProvider>
    </SignupProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  openPolicyCertificate.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActivatedStep — certificate download failure messaging', () => {
  it('never calls window.alert when the popup is blocked — surfaces the app\'s own in-page toast instead', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    openPolicyCertificate.mockReturnValue(false); // simulates a genuinely blocked popup

    renderStep();
    await user.click(screen.getByRole('button', { name: /download/i }));

    expect(alertSpy).not.toHaveBeenCalled();
    // Same copy the blocking alert used to show, now delivered through the
    // app's own toast region (src/components/Toast.jsx). Scoped to the
    // "Notifications" region specifically — ActivatedStep's own "Payment
    // successful" banner also carries role="status" (legitimately, it's
    // unrelated), so an unscoped findByRole('status') is ambiguous here.
    const notifications = screen.getByRole('region', { name: /notifications/i });
    expect(await within(notifications).findByRole('status')).toHaveTextContent(
      /allow pop-ups for this site/i,
    );
  });

  it('shows no error messaging at all when the certificate opens successfully', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    openPolicyCertificate.mockReturnValue(true);

    renderStep();
    await user.click(screen.getByRole('button', { name: /download/i }));

    expect(alertSpy).not.toHaveBeenCalled();
    // Same scoping as above: only the Notifications region should be empty —
    // the step's own payment-success banner keeps its unrelated role="status".
    const notifications = screen.getByRole('region', { name: /notifications/i });
    expect(within(notifications).queryByRole('status')).not.toBeInTheDocument();
  });
});
