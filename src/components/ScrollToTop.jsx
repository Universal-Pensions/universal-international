import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

// React Router 7's declarative <Routes> doesn't restore scroll on its own.
// Reset window scroll on every pathname change. No-op for the dashboard
// shells (they're position:fixed and scroll their own inner viewport).
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    // `behavior: 'instant'` bypasses the global `scroll-behavior: smooth`
    // (index.css) — the 2-arg scrollTo(0,0) inherits `smooth`, whose animation
    // is cancelled by the incoming route's relayout, leaving the page scrolled
    // mid-way. An instant jump lands every new page at the top.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}
