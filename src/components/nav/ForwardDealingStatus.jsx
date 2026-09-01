// The go/no-go check for forward dealing, on a screen instead of in a runbook.
//
// `forward_dealing_readiness()` (0158) has existed and worked since the day the
// switch was flipped, and the only way to read it was to open a SQL client —
// docs/runbooks/nav-publishing.md literally instructs the operator to run
// `SELECT jsonb_pretty(public.forward_dealing_readiness('UPU-BAL'));` before
// acting. A pre-flight check you have to go and find is one that gets skipped,
// and 0158's whole argument is that this fact belongs in front of whoever is
// about to act.
//
// It lives on the NAV page rather than somewhere ops-shaped, because the
// dominant blocker is "N business days have no published price" and the only
// place to fix that is the publish form six inches below this.
//
// SHARED between desktop and mobile: the two have no CSS in common, so this owns
// the WORDS and the structure, and each surface styles `[data-kind]` from its own
// sheet. The one thing that must never differ between the phone and the laptop is
// whether the fund is safe to run.

/**
 * @param {{
 *   readiness?: object|null,   // EMPTY_DEALING_READINESS shape
 *   isLoading?: boolean,
 *   error?: Error|null,
 *   className?: string,        // applied to the list
 *   statusClassName?: string,  // applied to the one-line verdict
 * }} props
 */
export default function ForwardDealingStatus({
  readiness,
  isLoading = false,
  error = null,
  className,
  statusClassName,
}) {
  if (isLoading) {
    return <p className={statusClassName}>Checking…</p>;
  }

  // Surfaced, never swallowed. An unanswered safety check must not look like a
  // clean bill of health — that is the one failure mode worth designing against
  // here, because the reader's next action is to leave the switch alone or not.
  if (error) {
    return (
      <p className={statusClassName} data-kind="blocker" role="alert">
        Could not check whether the fund is safe to run. Treat this as
        &ldquo;not checked&rdquo;, not as &ldquo;fine&rdquo;.
      </p>
    );
  }

  if (!readiness) return null;

  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
  const on = Boolean(readiness.pricingEnabled);
  const ready = Boolean(readiness.ready);

  return (
    <>
      <p className={statusClassName} data-kind={ready ? 'ok' : 'blocker'}>
        {on
          ? ready
            ? 'Running normally. Money is priced by the day it arrives.'
            : 'Running, but something below needs attention.'
          : ready
            ? 'Switched off, and safe to switch on.'
            : 'Switched off. Fix the points below before switching on.'}
        {readiness.cutoffLocalTime && (
          <> Cut-off {String(readiness.cutoffLocalTime).slice(0, 5)}, {readiness.timezone}.</>
        )}
      </p>

      {(blockers.length > 0 || warnings.length > 0) && (
        <ul className={className}>
          {blockers.map((b) => (
            <li key={b} data-kind="blocker">{b}</li>
          ))}
          {/* Warnings sit BELOW blockers deliberately: a blocker is "not now",
              a warning is "not for long". The movable holidays live here —
              Eid is moon-sighted, so it can only ever come from the gazette. */}
          {warnings.map((w) => (
            <li key={w} data-kind="warning">{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}
