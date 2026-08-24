# Pre-registered finding — distributor Reports unreachable at every viewport

**Raised by:** A00 (Phase 0), statically proven before Phase 3 began.
**Owner for runtime confirmation:** A13 (distributor), with A18 (mobile) on the viewport question.
**Plan reference:** the audit plan §5 "Known open bug" and the §9 acceptance criterion requiring this
be *"either confirmed with evidence or refuted with evidence — not omitted"*.

**Status: CONFIRMED statically. Runtime reproduction still owed by A13.**

## The chain, end to end

**1. The missing guard — `src/contexts/DashboardNavContext.jsx:92`**
```js
const usesReportsPanel = role === 'distributor' || (role === 'branch' && !isDesktop);
```
The `branch` arm is viewport-guarded with `!isDesktop`. **The `distributor` arm is not.**
So for `role === 'distributor'`, `usesReportsPanel` is `true` at *every* viewport — 375 px included.

**2. The redirect it drives — `DashboardNavContext.jsx:110-116`**
```js
useEffect(() => {
  if (!usesReportsPanel) return;
  if (section === 'reports') {
    onPanelActionRef.current?.setViewReportsOpen(true);
    navigate('/dashboard', { replace: true });
  }
}, [section, navigate, usesReportsPanel]);
```
Any distributor URL whose section is `reports` is rewritten to `/dashboard` with `replace: true` —
so it does not even leave a history entry to go back to.

**3. The routes this orphans — `src/dashboard/shell/DistributorMobileShell.jsx:55-56`**
```jsx
<Route path="reports/:reportId" element={<ReportViewMobile />} />
<Route path="reports"          element={<ReportsMobile />} />
```
Both components exist and are fully built:
`src/dashboard/mobile/ReportsMobile.jsx`, `src/dashboard/mobile/ReportViewMobile.jsx`.

**4. The entry point a rep actually taps — `src/dashboard/mobile/DistributorHubMobile.jsx:96`**
```jsx
<NavLink to="/dashboard/reports" className={styles.tile} aria-label="Reports">
  <span><b>Reports</b><small>Download data</small></span>
</NavLink>
```

**5. Corroboration that this was meant to work — `src/dashboard/shell/DistributorMobileAppBar.jsx:30,46`**
```js
'/dashboard/reports': 'Reports',
if (pathname.startsWith('/dashboard/reports/')) return { left: 'back', title: 'Report', actions: false };
```
The mobile app bar carries dedicated title/back configuration for both routes. The design plainly
expects them to render; only the nav context prevents it.

## What a rep sees
A distributor opens the demo on a phone, taps the **Reports** tile ("Download data"), and is bounced
straight back to the dashboard home. On a phone there is no slide-in panel worth showing, so the tap
simply appears to do nothing. `ReportsMobile`, `ReportViewMobile` and every report view reachable
through them are dead code on mobile.

## Severity
**High** under the plan's §3 rubric — *"a whole feature or route is unreachable or broken on a
supported viewport"*. Promote to **Critical** only if A13 shows a rep would hit it on a viewport used
in an actual sales demo; A13 and S2 own that call.

## Suggested fix (do NOT apply — report-only)
Give the distributor arm the same viewport guard the branch arm already has:
```js
const usesReportsPanel = (role === 'distributor' || role === 'branch') && !isDesktop;
```
Then confirm the desktop distributor panel behaviour is unchanged, since that arm is the one currently
relied upon at >=1024 px. Effort: **S** (one line + regression test), but it needs an E2E test at
375 px to stop it regressing again — note that the existing suite never caught this.

## Why the existing tests missed it
`e2e/specs/flows/distributor-exports-csv.spec.ts` exercises CSV export via the *subscriber* reports
path and the desktop distributor panel, never `/dashboard/reports` as a distributor at a mobile
viewport. A25 owns the coverage-gap write-up.
