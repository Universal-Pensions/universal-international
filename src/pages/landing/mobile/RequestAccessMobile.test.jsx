import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/requestAccess', () => ({
  submitAccessRequest: vi.fn(() => Promise.resolve({ id: 'req-1' })),
}));

import RequestAccessMobile from './RequestAccessMobile';

// A16-001 / A18-004 regression guard — see AboutMobile.test.jsx for the full
// defect writeup. This page had a <h2> top heading and no <h1> at all, on
// both the employer and distributor copy variants.
describe('RequestAccessMobile', () => {
  it('opens with a level-1 heading naming the page (employer copy, default)', () => {
    render(
      <MemoryRouter initialEntries={['/request-access']}>
        <RequestAccessMobile />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Set up Universal Pensions for your team');
  });

  it('opens with a level-1 heading naming the page (distributor copy)', () => {
    render(
      <MemoryRouter initialEntries={['/request-access?type=distributor']}>
        <RequestAccessMobile />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Become a Universal Pensions partner');
  });

  it('keeps a clean heading order after a successful submit (h1 -> h2, not h1 -> h3)', async () => {
    render(
      <MemoryRouter initialEntries={['/request-access']}>
        <RequestAccessMobile />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(screen.getByLabelText('Company registration number'), { target: { value: '80020002345678' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Grace Atim' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'grace@example.com' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0771234567' } });
    fireEvent.change(screen.getByLabelText('What your company does'), { target: { value: 'Manufacturing' } });
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Kampala' } });
    fireEvent.click(screen.getByRole('button', { name: /request access/i }));

    // The post-submit "Request received" panel used to be an <h3> — same
    // latent h1 -> h3 skip risk as ContactMobile. It's <h2> now.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Request received'),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Set up Universal Pensions for your team');
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });
});
