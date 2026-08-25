// RTL smoke test for the admin CreateEmployer panel — the district field's
// datalist-backed picker (E19) specifically.
//
// Escalation E19: the district input was free text with only a name-style
// placeholder ("e.g. Kampala"), while the create_employer RPC historically
// validated it strictly as a `districts.id`. Migration 0121 now accepts
// EITHER form (see live pg_get_functiondef, verified 2026-08-25 — it resolves
// `districts.id = p_district OR lower(districts.name) = lower(p_district)`),
// so this is no longer a hard break, but an unconstrained field will silently
// produce bad data again the moment the RPC is ever tightened. The fix mirrors
// the existing pattern at src/pages/RequestAccess.jsx (`list="ra-districts"`)
// instead of inventing a second one: a native <datalist> that steers typing
// toward a real district name while still accepting free text.
//
// Mounts with the real AdminPanelProvider + ToastProvider + QueryClientProvider
// (same stack as ViewEmployerDetail.test.jsx), and a mocked employer service so
// no Supabase call is made.

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/employer', () => ({
  createEmployer: vi.fn(),
}));

const employer = await import('../../services/employer');
const { AdminPanelProvider, useAdminPanel } = await import('../../contexts/AdminPanelContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: CreateEmployer } = await import('./CreateEmployer');
const { DISTRICT_NAMES } = await import('../../constants/districts');

// Host that opens the create-employer panel on mount (it renders nothing
// while createEmployerOpen is false).
function OpenOnMount() {
  const { setCreateEmployerOpen } = useAdminPanel();
  React.useEffect(() => {
    setCreateEmployerOpen(true);
  }, [setCreateEmployerOpen]);
  return <CreateEmployer />;
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdminPanelProvider>
          <OpenOnMount />
        </AdminPanelProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  employer.createEmployer.mockResolvedValue({ id: 'emp-new-1', name: 'Test Co' });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('<CreateEmployer /> — district field (E19)', () => {
  it('associates the district input with a real <label> (not just a placeholder)', () => {
    renderPanel();
    // getByLabelText fails unless the input has a properly wired
    // <label htmlFor>/aria-label — this is the accessible-name check the
    // escalation's "unlabelled" framing was about.
    const input = screen.getByLabelText('District');
    expect(input.tagName).toBe('INPUT');
  });

  it('wires the district input to a datalist listing every seeded district, mirroring RequestAccess', () => {
    renderPanel();
    const input = screen.getByLabelText('District');
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    // Datalist <option>s aren't exposed through an RTL accessible query —
    // this is the standard way to assert a native list= wiring.
    // eslint-disable-next-line testing-library/no-node-access
    const datalist = document.getElementById(listId);
    expect(datalist?.tagName).toBe('DATALIST');
    const optionValues = Array.from(datalist.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toEqual(DISTRICT_NAMES);
    expect(optionValues).toContain('Kampala');
  });

  it('still submits free text outside the datalist — the picker steers, it does not constrain (RPC accepts name OR id, 0121)', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/Company name/), 'Kampala Textiles Ltd');
    await user.type(screen.getByLabelText('District'), 'Not A Real District');
    await user.click(screen.getByRole('button', { name: /Create employer/i }));

    await waitFor(() => expect(employer.createEmployer).toHaveBeenCalledTimes(1));
    expect(employer.createEmployer.mock.calls[0][0]).toMatchObject({
      name: 'Kampala Textiles Ltd',
      district: 'Not A Real District',
    });
  });

  it('submits a datalist-suggested district name unchanged', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText(/Company name/), 'Busoga Farmers Co-op');
    await user.type(screen.getByLabelText('District'), 'Jinja');
    await user.click(screen.getByRole('button', { name: /Create employer/i }));

    await waitFor(() => expect(employer.createEmployer).toHaveBeenCalledTimes(1));
    expect(employer.createEmployer.mock.calls[0][0]).toMatchObject({ district: 'Jinja' });
  });
});
