// Map drill-down regression spec (distributor + admin) — pins audit §7f.
//
// §7f ACTUAL root cause (fixed in commit bc3312f): clicking a region/district
// polygon stopped drilling down because react-leaflet binds each <GeoJSON>
// onEachFeature click handler exactly ONCE per layer. When the GeoJSON paints
// before the entity hooks (useAllEntities) resolve — the geojson fetch and the
// data queries race — that one-time-bound handler captures an EMPTY name→id map.
// Hover still fires (DOM mouseover, no lookup needed), but on click the polygon's
// region/district NAME never resolves to an id, so drillDown(...) is never called
// and the URL never advances. The fix reads the name→id map through an
// always-current ref (regionNameToIdRef.current / districtNameToIdRef.current in
// UgandaMap.jsx) so the click handler sees the resolved entities even though it
// was bound while the map was still empty. (An EARLIER audit pass MISDIAGNOSED
// this as a "stale Leaflet projection / invalidateSize" hit-testing bug — it is
// NOT; the projection is fine, the captured lookup table was the empty one.)
//
// UgandaMap.jsx is the SINGLE shared map mounted by BOTH DashboardShell
// (distributor) and AdminDashboardShell (admin), so this regression is global to
// every map-theme role — hence we parametrize over both roles here. This spec is
// the "optionally add a regression E2E clicking a known region path asserting the
// URL change" called for in §7f's fix spec step 3.
//
// The drill advances the URL: country (/dashboard) → /dashboard/regions/<id> →
// /dashboard/districts/<id> (LEVEL_TO_SEGMENT is PLURAL — src/constants/levels.js).
//
// CATCHING A REVERT: the bug makes a real click silently no-op (empty name→id
// map → no drillDown), so the regression value is asserting that a genuine
// hit-tested click on a settled polygon DRILLS. If the ref fix is reverted, no
// click at any coordinate resolves an id, the URL never changes, and the test
// fails.
//
// HISTORY, so the discipline here is not mistaken for carelessness: this spec
// originally performed exactly ONE `.click()` with no retry, on the reasoning
// that a re-clicking poll would mask a "first click doesn't work" bug. Two
// things later broke that. (1) The two-mode redesign (65dcab5, 2026-07-22) moved
// the map behind the "Map view" switch, so `/dashboard` no longer renders one at
// all. (2) The map swaps its polygon layers asynchronously as metrics land, so a
// strict single click raced NODE IDENTITY and failed ~1 run in 3 for reasons
// unrelated to drilling. It now clicks by coordinate, up to 3 bounded attempts,
// re-settling between each. See `clickPolygonUntilUrl` for why the guard is
// intact: a genuinely broken drill exhausts every attempt and still fails.

import { test, expect, type Page } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor, type Role } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

// Both map-theme roles mount the same UgandaMap; the regression must hold for both.
const MAP_ROLES: Role[] = ['distributor', 'admin'];

// Interactive Leaflet GeoJSON polygons carry `.leaflet-interactive`. The region
// layer renders first (always loaded); the district layer renders after a region
// drill. We click the FIRST interactive path at each level.
const INTERACTIVE_PATH = '.leaflet-interactive';

/**
 * Block until the Leaflet map has stopped moving.
 *
 * Leaflet animates zoom / fitBounds by transforming `.leaflet-map-pane`, and the
 * polygons ride that transform. Playwright's actionability check requires an
 * element to be "stable" — same bounding box across two consecutive animation
 * frames — so clicking mid-animation fails with a 10s
 * "waiting for element to be visible, enabled and stable" timeout, which is
 * exactly how these two specs failed after they were pointed at map mode.
 *
 * `disableAnimations` does not help: it neutralises CSS/Framer transitions, not
 * Leaflet's own rAF-driven pane transform.
 *
 * This waits for the pane transform to be IDENTICAL across two polls, which is
 * a settle gate, not a retry — the single-click drill discipline below is
 * untouched.
 */
async function waitForMapSettled(page: Page, label: string): Promise<void> {
  await expect(
    page.locator(INTERACTIVE_PATH).first(),
    `${label}: an interactive polygon should render`,
  ).toBeVisible({ timeout: 30_000 });

  // NOT `waitForLoadState('networkidle')`: this app keeps polling (React Query
  // refetches, realtime-ish reads), so idle is frequently never reached — the
  // wait burns its whole budget and then clicks an *unsettled* map, which is
  // measurably worse (failing runs took 23s, passing ones 8s).

  await page.waitForFunction(
    () => {
      const pane = document.querySelector('.leaflet-map-pane');
      if (!pane) return false;
      const els = Array.from(document.querySelectorAll('.leaflet-interactive'));
      if (els.length === 0) return false;

      const w = window as unknown as { __upMapT?: string; __upCount?: number; __upOk?: number };
      const transform = getComputedStyle(pane as Element).transform;
      // Require a SUSTAINED stable window, not just two matching samples. The
      // polygon layer is remounted once the metrics rollup lands and recolours
      // every <path>; on a cold server that can arrive seconds after the first
      // paint, i.e. after a two-sample gate has already declared victory — and
      // the click then dies on "element was detached from the DOM, retrying".
      const NEEDED = 4; // ×300ms ≈ 1.2s of genuine quiescence

      // DOM-churn gate. The map REMOUNTS its GeoJSON layer as data lands (the
      // recolour from the metrics rollup swaps every <path>), so a locator that
      // resolved a moment ago gets "element was detached from the DOM, retrying"
      // and the click can spin until timeout. Tag the current nodes; only report
      // settled once the very same nodes — same count, still carrying the tag —
      // survive a whole poll interval.
      const allTagged = els.every((el) => el.hasAttribute('data-up-settled'));
      if (!allTagged) {
        els.forEach((el) => el.setAttribute('data-up-settled', '1'));
        w.__upCount = els.length;
        w.__upMapT = transform;
        w.__upOk = 0; // a remount resets the streak
        return false;
      }

      // Plus the pane-transform gate: Leaflet animates zoom/fitBounds by
      // transforming the pane, and the polygons ride it.
      const stable = w.__upCount === els.length && w.__upMapT === transform;
      w.__upCount = els.length;
      w.__upMapT = transform;
      w.__upOk = stable ? (w.__upOk ?? 0) + 1 : 0;
      return (w.__upOk ?? 0) >= NEEDED;
    },
    undefined,
    { timeout: 30_000, polling: 300 },
  );
}

/**
 * Click a settled Leaflet polygon and assert the URL advances to `expectSegment`.
 *
 * With the bc3312f ref fix in place a genuine click resolves the polygon
 * name → id and drills, so the URL advances. If that fix is reverted the handler
 * holds an empty name→id map, drillDown never fires, and NO click at ANY
 * coordinate can advance the URL — every attempt is exhausted and this throws,
 * which is the regression the spec exists to catch (mutation-verified).
 *
 * Bounded to 3 attempts, re-settling between each, because the map swaps its
 * polygon layers asynchronously as metrics land; a strict single click raced
 * node identity and failed ~1 run in 3 for reasons unrelated to drilling. Never
 * `force: true` — the click must hit-test a real, visible, settled polygon.
 *
 * ⚠️ CORRECTED 2026-08-25 (docs/audits/2026-08-23/a25/webkit-diagnosis.md,
 * finding A25-013/Phase 7): the district-click target picker below used to
 * choose its candidate purely by bounding-box AREA ("drop the single largest,
 * take the next-largest"), assuming the only oversized non-clickable shape is
 * one enclosing outline. That assumption breaks once a region has been
 * drilled into: `UgandaMap.jsx`'s Layer 2 (the colored region overlay,
 * `regionOverlayStyle`) stays mounted and `.leaflet-interactive` for ALL FOUR
 * regions at every drill level, but only gets a click handler
 * (`onEachFeature: onEachRegion`) at `level === 'country'`. So once inside a
 * region there are up to FOUR oversized, non-clickable region shapes on the
 * page at once, not one — "drop one, take the next" routinely just drops one
 * decoy and clicks another. Measured: this failed on WebKit 5/5 runs AND on
 * CHROMIUM 2/5 runs with a byte-identical error — a real cross-engine flake
 * the audit's "WebKit-only" framing missed (A25-013's "modal-escape is the
 * ONLY true flake" claim was wrong for exactly this reason). This is NOT a
 * revival of the historical onEachFeature empty-name→id race — that fix is
 * confirmed still working (a positive control clicking a real district
 * passed 6/6 on both engines). Fix: for a DISTRICT click, filter candidates
 * to TRANSPARENT-fill shapes first (`fill-opacity="0"`, exactly what
 * `getCachedDistrictStyle` in UgandaMap.jsx gives real districts — the
 * region-overlay decoys are always painted at 0.03–0.1, never 0) before
 * applying the drop-biggest-take-next heuristic below. The region click
 * (country level) is untouched: Layer 2 IS the real, clickable target there.
 */
async function clickPolygonUntilUrl(
  page: Page,
  expectSegment: 'regions' | 'districts',
  label: string,
): Promise<void> {
  // Wait for at least one interactive polygon to render AND for the Leaflet pane
  // to stop animating, so the click below hit-tests a settled polygon.
  await waitForMapSettled(page, label);

  // Pick the BIGGEST real shape: drop the single largest polygon, then take the
  // largest of what remains.
  //
  // Two traps this avoids, both hit while fixing this spec:
  //
  //  * `.first()` — after the region drill the layer set is the region OUTLINE
  //    plus its districts, and the outline is index 0 at ~1097×739 (the whole
  //    map). Playwright aims at an element's CENTRE, which for the outline lands
  //    on whichever district is painted on top, so the hit-test never resolves
  //    back to the outline and the click retries until timeout.
  //
  //  * smallest-polygon — safely never the outline, but a sliver district's
  //    centre is easily occluded by neighbours drawn over it, so the click lands
  //    on the wrong shape and the URL never advances. Observed on r-eastern.
  //
  // The enclosing outline is by definition the largest bbox (it bounds every
  // child), so dropping exactly one and taking the next gives the biggest
  // genuinely-clickable target. At country level there is no outline — only the
  // 4 region shapes — so this simply picks the second-largest region, which is
  // equally valid.
  //
  // For a DISTRICT click this now runs on a PRE-FILTERED candidate list (see
  // the function doc comment above): only transparent-fill shapes, i.e. real
  // districts, so there is no non-clickable outline left to "drop" at all —
  // the drop-biggest-take-next step is kept anyway (rather than just taking
  // the single largest) so a sliver district still isn't preferentially
  // chosen, matching the same occlusion reasoning as the region case above.
  const targetIndex = await page.locator(INTERACTIVE_PATH).evaluateAll((els, segment) => {
    let candidates = els
      .map((el, i) => {
        const r = el.getBoundingClientRect();
        const fillOpacityAttr = el.getAttribute('fill-opacity');
        const fillOpacity = fillOpacityAttr === null ? null : parseFloat(fillOpacityAttr);
        return { i, area: r.width * r.height, fillOpacity };
      })
      .filter((a) => a.area > 0);

    if (segment === 'districts') {
      // Real districts (UgandaMap.jsx's districtStyle / getCachedDistrictStyle)
      // render with fillOpacity: 0 — a genuine transparent fill, set as the
      // SVG `fill-opacity` presentation attribute by Leaflet's SVG renderer
      // (L.SVG._updateStyle calls path.setAttribute('fill-opacity', …)). The
      // region overlay's decoys never use exactly 0 (0.03 unselected / 0.1
      // selected), so this filter cleanly separates real targets from decoys.
      // Fall back to the unfiltered set if nothing matches for some unforeseen
      // reason — better to fall back to the old heuristic than to throw with
      // zero candidates.
      const transparent = candidates.filter((a) => a.fillOpacity === 0);
      if (transparent.length > 0) candidates = transparent;
    }

    if (candidates.length === 0) return 0;
    candidates.sort((a, b) => b.area - a.area);
    // candidates[0] is the outline when one is present; fall back to it if it
    // is the only shape on the layer.
    return (candidates[1] ?? candidates[0]).i;
  }, expectSegment);
  // Click by COORDINATE, not by element handle.
  //
  // Why not `locator.click()`: the map swaps its polygon layers asynchronously
  // (the metrics recolour replaces the teal region <path>s with a different,
  // faint layer). A locator that resolved a moment earlier then reports
  // "element was detached from the DOM, retrying" and can re-resolve onto the
  // wrong layer, spinning until timeout. That is a race on NODE IDENTITY, not
  // on whether the drill works. A mouse click at a point hit-tests whatever
  // polygon occupies that pixel at click time — exactly what a user does.
  //
  // ⚠️ DELIBERATE RELAXATION, recorded honestly. This helper used to promise
  // "ONE click, no retry", on the reasoning that a re-clicking poll would mask a
  // broken §7f ref fix. That promise could not survive the layer swap: measured
  // over repeated cold runs, a strict single click failed roughly 1 run in 3
  // purely because the layer changed between measuring the polygon and clicking
  // it — a false alarm, not a real defect.
  //
  // What the bound preserves: if the ref fix is reverted, `drillDown` never
  // fires, so NO click at ANY coordinate advances the URL and all attempts are
  // exhausted — the test still fails, which is the regression this exists to
  // catch. What it now tolerates is only "the layer was mid-swap on the first
  // attempt", which a real user resolves by clicking again.
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    // Re-measure every attempt — a swap invalidates the previous geometry.
    const box = await page.locator(INTERACTIVE_PATH).nth(targetIndex).boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      try {
        await page.waitForURL(`**/dashboard/${expectSegment}/**`, { timeout: 6_000 });
        return;
      } catch {
        if (attempt === ATTEMPTS) break;
      }
    }
    await waitForMapSettled(page, `${label} (retry ${attempt})`);
  }

  // Exhausted: the drill genuinely never happened. This is the failure the spec
  // exists to surface (e.g. the ref fix reverted → empty name→id map).
  throw new Error(
    `${label}: ${ATTEMPTS} settled clicks did not advance the URL to /dashboard/${expectSegment}/… `
      + `(current: ${page.url()}). The polygon click is not resolving name → id.`,
  );
}

for (const role of MAP_ROLES) {
  test.describe(`map drill-down regression — ${role}`, () => {
    test.use({ storageState: storageStatePathFor(role) });
    test.setTimeout(60_000);

    test.beforeEach(async ({ page }) => {
      await disableAnimations(page);
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      // The shell mounted cleanly (no ErrorBoundary) before we touch the map.
      await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);

      // There is NO map at /dashboard any more. The two-mode redesign (65dcab5,
      // 2026-07-22) made dash mode the default landing state — a full-page
      // canvas with no Leaflet layer at all — and moved the drill-down map
      // behind the rail's "Map view" switch. Measured: 0 `.leaflet-interactive`
      // polygons in dash mode, 4 after the toggle. Without this click the spec
      // waits 20s for a polygon that was never going to render, which is
      // exactly how it failed before this line existed.
      await page.getByRole('switch', { name: /map view/i }).click();
    });

    test('clicking a region then a district drills country → region → district', async ({
      page,
    }) => {
      // Start at country level.
      await expect(page).toHaveURL(/\/dashboard\/?$/);

      // ── Region drill ────────────────────────────────────────────────────────
      // A single real click on a region polygon must advance the URL to
      // /dashboard/regions/<id> — the §7f ref fix has to resolve name → id.
      await clickPolygonUntilUrl(page, 'regions', `${role} region`);
      await expect(page).toHaveURL(/\/dashboard\/regions\/[^/]+/);

      // ── District drill ──────────────────────────────────────────────────────
      // The district GeoJSON renders after the region drill; click a district
      // polygon and confirm the URL advances to /dashboard/districts/<id>.
      await clickPolygonUntilUrl(page, 'districts', `${role} district`);
      await expect(page).toHaveURL(/\/dashboard\/districts\/[^/]+/);

      // No crash into the global fallback after the two drills.
      await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    });
  });
}
