import { useIsDesktop } from '../../hooks/useIsDesktop';
import PendingKycDesktop from '../desktop/PendingKycDesktop';
import PendingKycMobile from '../mobile/PendingKycMobile';

// Routed on BOTH form factors. Desktop used to redirect away from here because
// pending-KYC was a slide-over opened from Overview/Employees; that panel
// (kyc/PendingKyc.jsx) has been retired so the reminder flow lives in exactly
// one place. Both bodies run off `kyc/usePendingKycNudge`.
export default function PendingKycPage() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <PendingKycDesktop /> : <PendingKycMobile />;
}
