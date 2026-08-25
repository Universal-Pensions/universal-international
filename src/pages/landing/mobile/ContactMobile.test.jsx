import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/contact', () => ({
  submitContactForm: vi.fn(() => Promise.resolve({ id: 'contact-1' })),
}));

import ContactMobile from './ContactMobile';

// A16-001 / A18-004 regression guard — see AboutMobile.test.jsx for the full
// defect writeup. This page had a <h2> top heading and no <h1> at all.
describe('ContactMobile', () => {
  it('opens with a level-1 heading naming the page', () => {
    render(
      <MemoryRouter>
        <ContactMobile />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Contact us.');
  });

  it('keeps a clean heading order after a successful submit (h1 -> h2, not h1 -> h3)', async () => {
    render(
      <MemoryRouter>
        <ContactMobile />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace Atim' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'grace@example.com' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    // The post-submit "Message received" panel used to be an <h3>. Promoting
    // only the top heading to <h1> without touching it would have left a
    // LATENT h1 -> h3 skip that only ever showed up once a visitor submitted
    // the form — not caught by a page-load-only axe scan. It's <h2> now.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Message received'),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Contact us.');
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });
});
