import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { SignInProvider } from './contexts/SignInContext';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import SignInModal from './components/SignInModal';
import SubscribersPage from './pages/landing/SubscribersPage';
import ScrollToTop from './components/ScrollToTop';
import { hasDashboard } from './services/auth';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import About from './pages/About';
import AdminLogin from './pages/AdminLogin';
import RequestAccess from './pages/RequestAccess';

const DashboardShell = lazy(() => import('./dashboard/DashboardShell'));
const BranchDashboardShell = lazy(() => import('./branch-dashboard/BranchDashboardShell'));
const SubscriberDashboardShell = lazy(() => import('./subscriber-dashboard/SubscriberDashboardShell'));
const AgentDashboardShell = lazy(() => import('./agent-dashboard/AgentDashboardShell'));
// Phase 0 placeholder; Phase 1 replaces it with the real cloned-from-branch shell.
const EmployerDashboardShell = lazy(() => import('./employer-dashboard/EmployerDashboardShell'));
const AdminDashboardShell = lazy(() => import('./admin-dashboard/AdminDashboardShell'));
const SignupPage = lazy(() => import('./signup/SignupPage'));

function DashboardFallback() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-cloud)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: 32,
        height: 32,
        border: '2.5px solid var(--color-lavender)',
        borderTopColor: 'var(--color-indigo)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
    </div>
  );
}

const ROLE_LABELS = {
  subscriber: 'Subscriber',
  employer: 'Employer',
  distributor: 'Distributor Admin',
  branch: 'Branch Admin',
  agent: 'Agent',
  admin: 'Admin',
};

function ComingSoon() {
  const { role, logout } = useAuth();
  const navigate = useNavigate();

  function handleBack() {
    logout();
    navigate('/');
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'var(--font-body)',
      color: 'var(--color-slate)',
      gap: '1rem',
      padding: '2rem',
      textAlign: 'center',
      background: 'var(--color-cloud)',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(41, 40, 103, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-indigo)',
      }}>
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75"/>
          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
      </div>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        color: 'var(--color-indigo)',
        fontSize: 'var(--text-2xl)',
        fontWeight: 800,
        letterSpacing: '-0.03em',
        margin: 0,
      }}>
        {ROLE_LABELS[role] || 'Dashboard'} coming soon
      </h2>
      <p style={{ color: 'var(--color-gray)', maxWidth: 380, margin: 0, lineHeight: 1.6 }}>
        We&apos;re building your personalised dashboard experience. Check back soon.
      </p>
      <button
        onClick={handleBack}
        style={{
          background: 'var(--color-indigo)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-full)',
          padding: '0.75rem 2rem',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          marginTop: '0.5rem',
        }}
      >
        Back to home
      </button>
    </div>
  );
}

function ProtectedDashboard() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!hasDashboard(role)) return <Navigate to="/coming-soon" replace />;
  let Shell = DashboardShell;
  if (role === 'branch') Shell = BranchDashboardShell;
  else if (role === 'subscriber') Shell = SubscriberDashboardShell;
  else if (role === 'agent') Shell = AgentDashboardShell;
  else if (role === 'employer') Shell = EmployerDashboardShell;
  else if (role === 'admin') Shell = AdminDashboardShell;
  return (
    <ErrorBoundary>
      <Suspense fallback={<DashboardFallback />}>
        <Shell />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <SignInProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<SubscribersPage />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/about" element={<About />} />
        <Route path="/coming-soon" element={<ComingSoon />} />
        {/* Super-admin login portal (role-fixed to admin). */}
        <Route path="/admin" element={<AdminLogin />} />
        {/* Lead-capture for employer/distributor (admin-provisioned, not self-signup). */}
        <Route path="/request-access" element={<RequestAccess />} />
        <Route
          path="/signup/*"
          element={
            <ErrorBoundary>
              <Suspense fallback={<DashboardFallback />}>
                <SignupPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        {/* Employer-invite entry — same KYC signup flow, pre-seeded from the
            invite token (employer-tagged subscriber on completion). Wildcard so
            the /invite/:token/contribution sub-step stays in the SAME provider
            (no remount → no lost-patch handoff). */}
        <Route
          path="/invite/:token/*"
          element={
            <ErrorBoundary>
              <Suspense fallback={<DashboardFallback />}>
                <SignupPage />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route path="/dashboard/*" element={<ProtectedDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SignInModal />
    </SignInProvider>
  );
}
