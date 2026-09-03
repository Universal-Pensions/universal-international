// Guards the three defects the user reported on the live desktop page:
//   1. phone/sector/district were optional — the phone is the SIGN-IN KEY
//   2. the page scrolled to enter a handful of fields
//   3. the brand logo was missing (an inline shield SVG stood in for it)
// (2) is a layout property that jsdom cannot measure; it is covered by the
// height budget documented in RequestAccess.module.css and a browser pass.
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../services/requestAccess', () => ({ submitAccessRequest: vi.fn() }));

const { submitAccessRequest } = await import('../services/requestAccess');
const { default: RequestAccess } = await import('./RequestAccess');

function renderAt(search = '?type=employer') {
  return render(
    <MemoryRouter initialEntries={[`/request-access${search}`]}>
      <RequestAccess />
    </MemoryRouter>,
  );
}

const fill = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });

const VALID = {
  'ra-org': 'Kampala Steel Ltd',
  // Required for BOTH kinds since 0095 — the admin "+ New Employer" form has
  // always captured it, so the public form provisioned a weaker account.
  'ra-registrationNo': '80020002345678',
  'ra-name': 'Jane Doe',
  'ra-email': 'jane@kampalasteel.co.ug',
  'ra-phone': '0771 234 567',
  'ra-sector': 'Manufacturing',
  'ra-district': 'Kampala',
};

beforeEach(() => vi.clearAllMocks());

describe('<RequestAccess />', () => {
  it('renders the real logo, not a stand-in word-mark', () => {
    renderAt();
    const img = screen.getByAltText('Universal Pensions');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/logo\.png$/);
  });

  it('says every field is required and marks none optional', () => {
    renderAt();
    expect(screen.getByText(/all fields are required/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/optional/i);
  });

  it('blocks an empty submit, shows one error per field, and focuses the first', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(submitAccessRequest).not.toHaveBeenCalled();
    for (const id of Object.keys(VALID)) {
      expect(document.getElementById(id)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(document.activeElement).toBe(document.getElementById('ra-org'));
  });

  // The bug: a request could be filed with no phone, which provisions an
  // account nobody can sign in to.
  it('rejects a submit with no phone', () => {
    renderAt();
    Object.entries(VALID).forEach(([id, v]) => fill(id, id === 'ra-phone' ? '' : v));
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(submitAccessRequest).not.toHaveBeenCalled();
    expect(document.getElementById('ra-phone')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(document.getElementById('ra-phone'));
  });

  it('rejects a non-Uganda phone number', () => {
    renderAt();
    Object.entries(VALID).forEach(([id, v]) => fill(id, id === 'ra-phone' ? '+1 555 0100' : v));
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));
    expect(submitAccessRequest).not.toHaveBeenCalled();
  });

  it('submits the phone canonicalised to +256XXXXXXXXX', async () => {
    submitAccessRequest.mockResolvedValueOnce({ submitted: true });
    renderAt();
    Object.entries(VALID).forEach(([id, v]) => fill(id, v));
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(submitAccessRequest).toHaveBeenCalledTimes(1));
    expect(submitAccessRequest).toHaveBeenCalledWith(expect.objectContaining({
      type: 'employer',
      orgName: 'Kampala Steel Ltd',
      registrationNo: '80020002345678',
      contactPhone: '+256771234567',
      sector: 'Manufacturing',
      district: 'Kampala',
    }));
  });

  it('surfaces a specific server error code, not the generic message', async () => {
    const err = new Error('bad'); err.code = 'invalid_district';
    submitAccessRequest.mockRejectedValueOnce(err);
    renderAt();
    Object.entries(VALID).forEach(([id, v]) => fill(id, v));
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/district/i));
  });

  it('confirms with a phone call, not an email we cannot send', async () => {
    submitAccessRequest.mockResolvedValueOnce({ submitted: true });
    renderAt();
    Object.entries(VALID).forEach(([id, v]) => fill(id, v));
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(screen.getByText(/request received/i)).toBeInTheDocument());
    expect(screen.getByRole('status').textContent).toMatch(/call you on/i);
    expect(screen.getByRole('status').textContent).not.toMatch(/email/i);
  });

  it('omits sector for a distributor but still asks for geography, incl. a mixed-case type', () => {
    renderAt('?type=Distributor');
    // Sector is the only employer-only field left. District moved out of that
    // block in 0140 — a distributor with no district cannot be placed on the
    // national map — and the office address behind it is distributor-only.
    expect(document.getElementById('ra-sector')).toBeNull();
    expect(document.getElementById('ra-district')).not.toBeNull();
    expect(document.getElementById('ra-physicalAddress')).not.toBeNull();
    expect(document.getElementById('ra-phone')).not.toBeNull();
  });

  it('asks an employer for district but not an office address', () => {
    renderAt('?type=employer');
    expect(document.getElementById('ra-sector')).not.toBeNull();
    expect(document.getElementById('ra-district')).not.toBeNull();
    expect(document.getElementById('ra-physicalAddress')).toBeNull();
  });
});
