import { Outlet } from 'react-router-dom';
import { useIsMobile } from '../../../hooks/useIsMobile';
import LandingMobileShell from './LandingMobileShell';

/**
 * LandingLayout — viewport gate for the public marketing routes. On a phone
 * (<=768px) it renders the phone-native app shell (which routes to *Mobile
 * screens by pathname). On larger screens it is transparent — just <Outlet/> —
 * so the existing desktop landing/support pages render byte-identically, with
 * zero changes to those page components.
 */
export default function LandingLayout() {
  const isMobile = useIsMobile();
  if (isMobile) return <LandingMobileShell />;
  return <Outlet />;
}
