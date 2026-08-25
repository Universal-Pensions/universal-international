import { useSyncExternalStore } from 'react';

// Threshold lowered 1024 -> 768 by A18-002 (2026-08-25): 1024 left 769-1023px
// (iPad portrait, incl. the classic 768x1024 non-Pro iPad and 810/834px
// devices) unowned by either this hook or useIsMobile.js, so every one of the
// 6 role shells' `isDesktop ? <Desktop/> : <Mobile/>` branch rendered the
// PHONE shell there — a stretched bottom-tab-bar UI in a tablet-width window.
//
// This is now MECE-adjacent with useIsMobile.js's `max-width: 767px`: no
// viewport width is unowned, and none is claimed by both.
//
// Before lowering this, verify the desktop shells' CSS still fits down to
// 768px — every one of the 6 shells relies on `min-width: 0` + `overflow-x:
// hidden` (or `overflow: hidden`) on its scrollable content column to make a
// page-level horizontal scrollbar structurally impossible regardless of
// viewport width; live-measured zero overflow across all 6 roles, the full
// 767-1024px range, and (distributor/admin) both dash and map mode. Full
// method + evidence: docs/audits/2026-08-23/a18/breakpoint-decision.md.
// Do not move this number again without reading that file and updating it.
const MQ = '(min-width: 768px)';

function subscribeMQ(cb) {
  const mql = window.matchMedia(MQ);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function getIsDesktop() {
  return window.matchMedia(MQ).matches;
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribeMQ, getIsDesktop);
}
