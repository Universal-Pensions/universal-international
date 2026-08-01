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
 * Click a Leaflet polygon ONCE and assert the URL advances to `expectSegment`.
 *
 * The single-click discipline is the whole point of the regression: with the ref
 * fix in place the first genuine click resolves the polygon name → id and drills,
 * so the URL advances. If the bc3312f ref fix is reverted, the click handler holds
 * an empty name→id map, drillDown never fires, and this waitForURL times out — the
 * failure we want. A re-clicking poll would paper over that, so we deliberately do
 * NOT retry the click and do NOT pass force:true (the click must hit-test a real,
 * visible, settled polygon).
 */
async function clickPolygonUntilUrl(
  page: Page,
  expectSegment: 'regions' | 'districts',
  label: string,
): Promise<void> {
  // Wait for at least one interactive polygon to render AND for the Leaflet pane
  // to stop animating, so the click below hit-tests a settled polygon.
  await waitForMapSettled(page, label);

  // Target the SMALLEST interactive polygon, not `.first()`.
  //
  // At region level `.first()` was fine (4 sibling region shapes). After the
  // region drill the layer set becomes the region OUTLINE plus its districts,
  // and the outline is index 0 at ~1097×739 — the full map. Clicking it fails
  // actionability forever: Playwright aims at the element's CENTRE, which lands
  // on whichever district is painted on top, so the hit-test never resolves to
  // the outline and the click retries until timeout. That is precisely how this
  // spec failed once it was pointed at map mode.
  //
  // The smallest shape is always a real district (or a real region at country
  // level), never the enclosing outline, so this is stable under layer-order
  // changes — unlike `.last()`, which only works by accident of append order.
  const smallestIndex = await page.locator(INTERACTIVE_PATH).evaluateAll((els) => {
    let best = 0;
    let bestArea = Infinity;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > 0 && area < bestArea) {
        bestArea = area;
        best = i;
      }
    });
    return best;
  });
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
    const box = await page.locator(INTERACTIVE_PATH).nth(smallestIndex).boundingBox();
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
