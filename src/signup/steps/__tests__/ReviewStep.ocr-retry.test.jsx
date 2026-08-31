// ReviewStep — OCR "Try again" retry behaviour (P5-T2a §01-M1).
//
// The bug: the error-screen "Try again" button only flipped ocrState back to
// 'running' without re-invoking extractIdFields, so the loading state hung
// forever. The fix drives OCR off an ocrRunId that the button bumps, so the
// effect re-runs. These tests pin both halves: OCR runs once on the happy
// mount, and a failed OCR can be retried to success via the button.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SignupProvider } from '../../SignupContext';
import ReviewStep from '../ReviewStep';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Districts come from useAllEntities — stub it so the combobox renders without
// touching the network / query client.
vi.mock('../../../hooks/useEntity', () => ({
  useAllEntities: () => ({ data: [{ id: 'd-1', name: 'Kampala' }] }),
}));

// extractIdFields is the OCR call under test — controlled per-test below.
const extractIdFields = vi.fn();
vi.mock('../../../services/kyc', () => ({
  extractIdFields: (...args) => extractIdFields(...args),
}));

const OCR_OK = {
  fullName: 'Asha Namuli',
  nin: 'CF1234567890AB',
  cardNumber: 'ABC123456789',
  dob: '1990-01-01',
  gender: 'female',
  barcodeRaw: 'raw',
  confidence: 0.95,
};

// ReviewStep reads the dealing date (when money paid in now starts working) via
// useDealingDate -> react-query, so the step needs a QueryClient. `retry: false`
// keeps a failed fetch from stalling the test; the note renders nothing when the
// date is unavailable, which is exactly what these OCR/identity tests expect.
function renderStep() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignupProvider>
        <ReviewStep onNext={() => {}} />
      </SignupProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  extractIdFields.mockReset();
});

describe('ReviewStep — OCR retry', () => {
  it('runs OCR once on mount and lands on the review form', async () => {
    extractIdFields.mockResolvedValue(OCR_OK);
    renderStep();

    await waitFor(() => expect(screen.getByText('Check your details')).toBeTruthy());
    expect(extractIdFields).toHaveBeenCalledTimes(1);
  });

  it('"Try again" re-invokes extractIdFields after a failure (no longer hangs)', async () => {
    extractIdFields
      .mockRejectedValueOnce(new Error('camera glare'))
      .mockResolvedValueOnce(OCR_OK);
    renderStep();

    // First run fails → the error screen with its message is shown.
    await waitFor(() => expect(screen.getByText('camera glare')).toBeTruthy());
    expect(extractIdFields).toHaveBeenCalledTimes(1);

    // The button must actually re-run OCR — the bug was it only set 'running'.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Check your details')).toBeTruthy());
    expect(extractIdFields).toHaveBeenCalledTimes(2);
  });
});
