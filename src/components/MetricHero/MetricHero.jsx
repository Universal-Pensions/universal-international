import { Children } from 'react';
import ErrorCard from '../feedback/ErrorCard';
import styles from './MetricHero.module.css';

/**
 * MetricHero — the shared primitive behind every "money hero" strip on the
 * platform (Admin / Distributor / Branch overview + agent/analytics KPI
 * headers, desktop and mobile).
 *
 * BACKGROUND (Phase 4 remediation — see docs/audits/2026-08-23 A22-002,
 * A15-002, A22-007): the remediation plan assumed one shared hero component
 * already existed. It does not. Eight call sites each grew their own copy of
 * the same "icon + label + big value + sub" tile and drifted apart:
 *
 *   - src/admin-dashboard/overview/AdminOverview.jsx
 *   - src/dashboard/overview/DistributorOverview.jsx
 *   - src/branch-dashboard/desktop/OverviewDesktop.jsx
 *   - src/branch-dashboard/desktop/AgentDetailDesktop.jsx
 *   - src/branch-dashboard/desktop/AnalyticsDesktop.jsx
 *   - src/branch-dashboard/mobile/BranchHomeMobile.jsx
 *   - src/admin-dashboard/mobile/AdminHomeMobile.jsx
 *   - src/dashboard/mobile/DistributorHomeMobile.jsx
 *
 * Six of the eight already gate the whole page behind a page-level
 * isLoading/isError guard (ErrorCard + spinner) before any tile mounts. Two
 * — AdminOverview and DistributorOverview, both desktop-only — do not: their
 * hero destructures `usePlatformOverview()`/`useEntityMetrics()` straight
 * into `?? {}` / `|| 0` fallbacks with no isError branch at all, so a failed
 * `get_platform_overview` / `get_entity_metrics_rollup` read renders a
 * confident "FUNDS UNDER MANAGEMENT —, 0 subscribers, Health Score 0 Needs
 * work" — indistinguishable from a genuinely empty platform, no message, no
 * retry (A22-002 / A15-002). The systemic root is that no read failure has a
 * guaranteed on-screen surface at all (A22-007).
 *
 * MetricHero is the fix, extracted as a primitive: an isLoading/isError/
 * onRetry-aware wrapper around one or more <MetricHero.Tile>. The three
 * states are mutually exclusive render branches, so the real tile content —
 * and therefore any value that happens to be zero — is ONLY EVER mounted in
 * the success branch. A read failure can no longer be silently rendered as
 * data:
 *
 *   isError   → reuses the app's <ErrorCard> (title + message + Retry),
 *               role="alert" via ErrorCard itself.
 *   isLoading → a skeleton grid, role="status" + aria-busy, never a "0".
 *   otherwise → the real <MetricHero.Tile> children, exactly as passed.
 *
 * This is EXTRACTION ONLY (Phase 4 foundation build). None of the 8 call
 * sites import this yet — a later wave adopts it into each file. Two things
 * this primitive deliberately does NOT cover (see escalations in the P4
 * agent report): the health-score gauge card (a structurally different
 * circular-gauge widget, rendered as a separate section in 6 of the 8 files)
 * and the mobile "stat strip" (plain number+label cells with no icon/card
 * chrome, distinct from a Tile). Both share the same isLoading/isError gap
 * on the two broken files but need their own follow-up primitive.
 *
 * `value` / `label` / `sub` are pre-formatted ReactNodes supplied by the
 * caller — MetricHero has no opinion on currency/number formatting (that
 * stays in src/utils/currency.js) and therefore no opinion on what a
 * genuine zero should look like. Its only job is guaranteeing that content
 * is never shown standing in for a read that failed.
 *
 * @param {Object} props
 * @param {boolean} [props.isLoading=false] — render the skeleton grid instead of children.
 * @param {boolean} [props.isError=false] — render the error state instead of children. Takes
 *   precedence over isLoading (a query that has errored is not "still loading").
 * @param {string|Error|null} [props.error] — passed straight to ErrorCard's `message`.
 * @param {Function} [props.onRetry] — passed straight to ErrorCard; omit to hide the Retry button.
 * @param {string} [props.errorTitle="We couldn't load this"] — ErrorCard headline.
 * @param {string} [props.loadingLabel="Loading metrics…"] — accessible name for the busy region.
 * @param {1|2|3|4} [props.columns] — grid column count. Defaults to the number of
 *   `MetricHero.Tile` children, clamped to 1–4 (a single `size="hero"` tile is columns=1).
 * @param {keyof JSX.IntrinsicElements} [props.as='section'] — root element tag.
 * @param {string} [props.className] — extra class(es) merged onto the root.
 * @param {import('react').ReactNode} props.children — one or more `<MetricHero.Tile>`.
 */
export default function MetricHero({
  isLoading = false,
  isError = false,
  error = null,
  onRetry,
  errorTitle = "We couldn't load this",
  loadingLabel = 'Loading metrics…',
  columns,
  as,
  className,
  children,
  ...rest
}) {
  // Assigned to a local capitalized `const` (rather than destructured+renamed
  // in the parameter list) to match the house convention this repo's lint
  // config actually exempts — see AdminOverview.jsx's/DistributorOverview.jsx's
  // own local `Tile`, which does the same `const Tag = onClick ? 'button' :
  // 'div'` dance. `no-unused-vars`'s `varsIgnorePattern: '^[A-Z_]'` only
  // reaches `const`/`let` locals, not destructured-and-renamed params.
  const Tag = as || 'section';
  const count = Math.max(1, Children.count(children));
  const cols = Math.min(4, Math.max(1, columns || count));
  const rootClass = [styles.root, className].filter(Boolean).join(' ');

  // isError wins over isLoading — a query that has settled into an error is
  // not "still loading" even if a consumer's isFetching flag is also true
  // (e.g. a background refetch-after-error). Showing the skeleton in that
  // case would flap between two non-answers instead of giving one clear one.
  if (isError) {
    return (
      <Tag className={rootClass} data-state="error" {...rest}>
        <ErrorCard title={errorTitle} message={error} onRetry={onRetry} />
      </Tag>
    );
  }

  if (isLoading) {
    return (
      <Tag
        className={rootClass}
        data-state="loading"
        role="status"
        aria-busy="true"
        aria-label={loadingLabel}
        {...rest}
      >
        <div className={styles.grid} data-cols={cols} aria-hidden="true">
          {Array.from({ length: count }).map((_, i) => (
            <MetricHeroTileSkeleton key={i} delay={i * 60} />
          ))}
        </div>
      </Tag>
    );
  }

  return (
    <Tag className={rootClass} data-state="ready" {...rest}>
      <div className={styles.grid} data-cols={cols}>
        {children}
      </div>
    </Tag>
  );
}

/**
 * One skeleton placeholder shaped like a default-size Tile (icon chip +
 * label + value + sub bars). Never renders "0" — a shimmering bar has no
 * numeric reading, so it cannot be mistaken for real (or missing) money.
 */
function MetricHeroTileSkeleton({ delay = 0 }) {
  return (
    <div className={styles.skeletonTile} style={{ animationDelay: `${delay}ms` }}>
      <span className={styles.skeletonChip} />
      <span className={`${styles.skeletonLine} ${styles.skeletonLabel}`} />
      <span className={`${styles.skeletonLine} ${styles.skeletonValue}`} />
      <span className={`${styles.skeletonLine} ${styles.skeletonSub}`} />
    </div>
  );
}

const TONES = new Set(['indigo', 'indigoSoft', 'green', 'teal', 'amber']);

/**
 * MetricHero.Tile — one metric.
 *
 * `size="default"` matches the desktop KPI card (icon chip + uppercase
 * label + big value + sub line) shared today by AdminOverview /
 * DistributorOverview / OverviewDesktop / AgentDetailDesktop /
 * AnalyticsDesktop, each with their own copy of the same shape.
 *
 * `size="hero"` matches the mobile "framed" headline stat (bigger value,
 * quieter sentence-case label, no forced icon) used by BranchHomeMobile /
 * AdminHomeMobile / DistributorHomeMobile's `.frame`/`.heroVal`.
 *
 * Renders as a `<button>` when `onClick` is passed (matches every existing
 * clickable-tile call site — e.g. the Subscribers/Agents tiles on
 * AdminOverview/DistributorOverview that open a panel), otherwise a plain
 * `<div>`. This mirrors the onClick-vs-div branch that three independent
 * local `Tile` implementations in the codebase already converged on.
 *
 * @param {Object} props
 * @param {'indigo'|'indigoSoft'|'green'|'teal'|'amber'} [props.tone='indigo']
 * @param {import('react').ReactNode} [props.icon]
 * @param {import('react').ReactNode} props.label
 * @param {import('react').ReactNode} props.value — pre-formatted; MetricHero renders it as-is.
 * @param {import('react').ReactNode} [props.sub]
 * @param {'up'|'down'} [props.subTone] — colors `sub` green/red (e.g. a month-over-month delta).
 * @param {Function} [props.onClick]
 * @param {'default'|'hero'} [props.size='default']
 * @param {string} [props.className]
 */
function MetricHeroTile({
  tone = 'indigo',
  icon,
  label,
  value,
  sub,
  subTone,
  onClick,
  size = 'default',
  className,
  ...rest
}) {
  const Comp = onClick ? 'button' : 'div';
  const safeTone = TONES.has(tone) ? tone : 'indigo';
  const cls = [styles.tile, className].filter(Boolean).join(' ');
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      className={cls}
      data-tone={safeTone}
      data-size={size}
      data-clickable={onClick ? 'true' : undefined}
      onClick={onClick}
      {...rest}
    >
      {icon && <span className={styles.tileIcon}>{icon}</span>}
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {sub != null && (
        <span className={styles.tileSub} data-tone={subTone}>{sub}</span>
      )}
    </Comp>
  );
}

MetricHero.Tile = MetricHeroTile;

export { MetricHeroTile };
