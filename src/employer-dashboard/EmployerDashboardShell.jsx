// Employer dashboard shell. Owns a single <Routes> table shared by both form
// factors: <Route element={<EmployerShell/>}> gates the chrome (desktop rail +
// Ask-AI copilot vs the mobile app-bar + bottom-nav), and each routed page gates
// its own desktop/mobile body. Mirrors AgentDashboardShell + AgentShell. The
// provider nest (EmployerDashboardProvider → EmployerScopeProvider) wraps the
// whole thing so both shells have panel + scope context.
//
// (Before the unified-routes refactor the desktop shell owned its own <Routes>
// and the mobile shell was a state-driven slide-in-panel layout; that legacy
// mobile shell has been removed from the render path.)

import { Navigate, useNavigate, Routes, Route } from 'react-router-dom';
import { EmployerDashboardProvider } from '../contexts/EmployerPanelContext';
import { EmployerScopeProvider } from '../contexts/EmployerScopeContext';
import { useAuth } from '../contexts/AuthContext';
import EmployerShell from './shell/EmployerShell';
import OverviewPage from './pages/OverviewPage';
import EmployeesPage from './pages/EmployeesPage';
import MemberDetailPage from './pages/MemberDetailPage';
import RunsPage from './pages/RunsPage';
import ContributionsPage from './pages/ContributionsPage';
import InsurancePage from './pages/InsurancePage';
import AnalyticsPage from './pages/AnalyticsPage';
import SupportPage from './pages/SupportPage';
import SettingsPage from './pages/SettingsPage';
import OnboardPage from './pages/OnboardPage';
import PendingKycPage from './pages/PendingKycPage';
import ProfilePage from './pages/ProfilePage';
import styles from './EmployerDashboardShell.module.css';

function MissingEmployerIdScreen({ onLogout }) {
  return (
    <div className={styles.missingEmployer}>
      <div className={styles.missingEmployerInner}>
        <h1 className={styles.missingEmployerTitle}>Employer not assigned</h1>
        <p className={styles.missingEmployerText}>
          Your account doesn&apos;t have an employer on file. Please contact an
          administrator to link your account to an employer before signing in again.
        </p>
        <button type="button" className={styles.missingEmployerBtn} onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function EmployerDashboardShell() {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  if (role !== 'employer') return <Navigate to="/coming-soon" replace />;
  const employerId = user?.employerId;
  if (!employerId) {
    return <MissingEmployerIdScreen onLogout={() => { logout(); navigate('/'); }} />;
  }
  return (
    <EmployerDashboardProvider>
      <EmployerScopeProvider employerId={employerId}>
        <Routes>
          <Route element={<EmployerShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/:id" element={<MemberDetailPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="contributions" element={<ContributionsPage />} />
            <Route path="insurance" element={<InsurancePage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="onboard" element={<OnboardPage />} />
            <Route path="pending-kyc" element={<PendingKycPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </EmployerScopeProvider>
    </EmployerDashboardProvider>
  );
}
