import { lazy, Suspense } from 'react';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageFallback from '../shell/PageFallback';
import ContributionsMobile from '../mobile/ContributionsMobile';

// Routed on BOTH form factors — the contribution-history drill-down behind the
// Overview's two leg tiles. Desktop is lazy (it's reached by a click from
// Overview, never on first paint), matching RunsPage.
const ContributionsDesktop = lazy(() => import('../desktop/ContributionsDesktop'));

export default function ContributionsPage() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return <ContributionsMobile />;
  return (
    <Suspense fallback={<PageFallback />}>
      <ContributionsDesktop />
    </Suspense>
  );
}
