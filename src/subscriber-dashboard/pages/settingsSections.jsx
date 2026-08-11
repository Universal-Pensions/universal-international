/**
 * Shared subscriber Settings section list — the row destinations + panel/soon
 * behaviour rendered by BOTH the mobile SettingsPage and the desktop
 * SettingsDesktop fork, so the two layouts never drift. Kept in its own module
 * (not exported from a component file) so fast-refresh stays happy.
 */
export const SECTIONS = [
  {
    id: 'profile',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    label: 'Profile',
    helper: 'Name, phone, email',
    to: '/dashboard/settings/profile',
  },
  {
    id: 'nominees',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M2 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 11a3.5 3.5 0 110-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M22 18a5 5 0 00-7-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    label: 'Nominees',
    helper: 'Who inherits your savings',
    to: '/dashboard/settings/nominees',
  },
  {
    id: 'insurance',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    label: 'Insurance cover',
    helper: 'Premium and policy level',
    to: '/dashboard/settings/insurance',
  },
  {
    id: 'schedule',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    label: 'Contribution settings',
    helper: 'Frequency, amount, split',
    to: '/dashboard/save/schedule',
  },
  {
    id: 'reports',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path d="M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M13 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    label: 'Analytics & reports',
    helper: 'Trends, statements, exports',
    to: '/dashboard/reports',
  },
  {
    id: 'agent',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17.5 5.5l1.8-1.8M19.5 9h2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    label: 'Your agent',
    helper: 'Contact and support details',
    to: '/dashboard/agent',
  },
  {
    id: 'help',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9.5 9.5a2.5 2.5 0 014.4 1.6c0 1.7-2.4 2-2.4 3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="11.9" cy="17" r="0.9" fill="currentColor" />
      </svg>
    ),
    label: 'Help',
    helper: 'FAQs and getting in touch',
    to: '/dashboard/help',
  },
  // No Notifications row: it was a permanently-disabled "Soon" tile pointing at
  // a route that only ever redirected back here (SubscriberDashboardShell
  // routes /dashboard/settings/notifications to <Navigate>). Contribution
  // settings took its slot in the list.
  {
    id: 'security',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
    label: 'Password & security',
    helper: 'Set or change your password',
    // Opens the shared <Settings /> slide-in panel (same component the
    // distributor and branch shells use) — exposes the password card here
    // since this routed page has no other surface for it.
    panel: 'settings',
  },
];
