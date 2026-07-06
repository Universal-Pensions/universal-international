import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

const { openSpy } = vi.hoisted(() => ({ openSpy: vi.fn() }));
vi.mock('../../../contexts/SignInContext', () => ({ useSignIn: () => ({ open: openSpy }) }));

// Stub the 7 screens so this test exercises the SHELL's own composition (app bar,
// action bar, audience, sheets) without pulling in the screens' data/services.
// Factories are hoisted, so the JSX is inlined (no shared top-level helper).
vi.mock('../mobile/SubscribersMobile', () => ({ default: (p) => <button type="button" data-testid="sub-screen" onClick={p.openCalc}>sub</button> }));
vi.mock('../mobile/EmployersMobile', () => ({ default: () => <div data-testid="emp-screen" /> }));
vi.mock('../mobile/DistributorsMobile', () => ({ default: () => <div data-testid="dist-screen" /> }));
vi.mock('../mobile/AboutMobile', () => ({ default: () => <div data-testid="about-screen" /> }));
vi.mock('../mobile/FAQMobile', () => ({ default: () => <div data-testid="faq-screen" /> }));
vi.mock('../mobile/ContactMobile', () => ({ default: () => <div data-testid="contact-screen" /> }));
vi.mock('../mobile/RequestAccessMobile', () => ({ default: () => <div data-testid="request-screen" /> }));

import LandingMobileShell from './LandingMobileShell';

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}
function Nav() {
  const navigate = useNavigate();
  return <button type="button" data-testid="nav-about" onClick={() => navigate('/about')}>go about</button>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LandingMobileShell />
      <Probe />
      <Nav />
    </MemoryRouter>,
  );
}

describe('LandingMobileShell', () => {
  beforeEach(() => openSpy.mockClear());

  it('routes to the right screen by pathname', () => {
    renderAt('/');
    expect(screen.getByTestId('sub-screen')).toBeInTheDocument();
    renderAt('/distributors');
    expect(screen.getByTestId('dist-screen')).toBeInTheDocument();
  });

  it('shows the logo (no back) on a home, back + title on a support page', () => {
    const { unmount } = renderAt('/');
    expect(screen.getByAltText('Universal Pensions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
    unmount();

    renderAt('/about');
    expect(screen.getByLabelText('Back')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('maps the Individuals action bar and its destinations', () => {
    renderAt('/');
    fireEvent.click(screen.getByText('Start saving'));
    expect(screen.getByTestId('loc').textContent).toBe('/signup');
    fireEvent.click(screen.getByText('Sign in'));
    expect(openSpy).toHaveBeenCalledWith('subscriber');
  });

  it('maps the Employers action bar and its destinations', () => {
    renderAt('/employers');
    fireEvent.click(screen.getByText('Log in'));
    expect(openSpy).toHaveBeenCalledWith('employer');
    fireEvent.click(screen.getByText('Set up your company'));
    expect(screen.getByTestId('loc').textContent).toBe('/request-access?type=employer');
  });

  it('maps the Distributors action bar to the partner request', () => {
    renderAt('/distributors');
    fireEvent.click(screen.getByText('Become a partner'));
    expect(screen.getByTestId('loc').textContent).toBe('/request-access?type=distributor');
  });

  it('hides the action bar on request-access (the screen owns its submit)', () => {
    renderAt('/request-access');
    expect(screen.queryByTestId('landing-actionbar')).not.toBeInTheDocument();
    expect(screen.getByTestId('request-screen')).toBeInTheDocument();
  });

  it('inherits the last audience onto support pages', () => {
    renderAt('/employers');
    // Navigate to /about within the same shell mount → audience stays employer.
    fireEvent.click(screen.getByTestId('nav-about'));
    expect(screen.getByTestId('about-screen')).toBeInTheDocument();
    expect(screen.getByText('Log in')).toBeInTheDocument(); // employer secondary, not "Sign in"
    // Back returns to the employer home.
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.getByTestId('loc').textContent).toBe('/employers');
  });

  it('opens the Menu sheet from the app bar', () => {
    renderAt('/');
    fireEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Choose your platform')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the Calculator sheet when the home preview is tapped', () => {
    renderAt('/');
    fireEvent.click(screen.getByTestId('sub-screen')); // stub's onClick = openCalc
    expect(screen.getByText('See your growth')).toBeInTheDocument();
  });
});
