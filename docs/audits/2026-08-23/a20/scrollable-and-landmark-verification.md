# A20 tail — scroll regions, landmarks, language

Four accessibility findings. **Two were already closed** by commits that never
named them, so the tracker — which derives closure from commit messages rather
than agent self-reports — kept counting them open. Verified exhaustively today
rather than from a sample, because a spot-check is exactly how the other two
came to look open.

---

## `A20-010` — `<html lang>` · ALREADY DONE

`index.html:2` reads `<html lang="en-UG">`.

Changed on this branch in `214aa00 fix(P6-csp-headers): self-host the fonts and
give the CSP somewhere to report` — a commit about fonts and CSP, which is why
`A20-010` was never mentioned:

```
-<html lang="en">
+<html lang="en-UG">
```

Matches `src/utils/currency.js:16` and `src/utils/date.js:11`, both of which
format as `en-UG`.

---

## `A20-006` — skip-link target focusable · ALREADY DONE

The finding says `<main id="main">` is not programmatically focusable, and that
`src/App.jsx:71` and `src/pages/AdminLogin.jsx:33` use `<div id="main">`.

Measured today across **all 27** `id="main"` sites in `src/`:

- every one is a `<main>` (or `<motion.main>`) element — **zero `<div id="main">` remain**;
- every one carries `tabIndex={-1}`;
- `src/App.jsx:71` → `<main id="main" tabIndex={-1}>`;
- `src/pages/AdminLogin.jsx:33` → `<main id="main" tabIndex={-1}>`.

A first pass appeared to show three sites missing `tabIndex`. All three were
false positives and are worth recording so the next reader does not re-raise them:

| site | why it looked missing |
|---|---|
| `src/signup/contribution/ContributionSettings.jsx:893` | a **code comment** explaining why this component deliberately does *not* render a second `<main>` |
| `src/signup/contribution/ContributionSettings.test.jsx:7` | the same explanation, in a test header comment |
| `src/pages/landing/shell/LandingMobileShell.jsx:137` | a `<motion.main>` — the crude tag regex did not match `motion.` |

---

## `A20-005` — scrollable tables keyboard-accessible · **PARTLY DONE, NOW CLOSED**

The landing pages were already correct:

```jsx
// src/pages/landing/mobile/SubscribersMobile.jsx:53
// src/pages/landing/mobile/DistributorsMobile.jsx:80
<div className={styles.quotesScroll} tabIndex={0} aria-label="Customer stories, scroll for more">
```

The shared `.tableScroll` shell was not, at **four** sites. `.tableScroll` is
`overflow-x: auto` (`ReportTable.module.css:13-17`), so it is a real scrollport:
on a narrow viewport the columns past the fold could be reached with a mouse or
a finger and **not at all with a keyboard**. Axe calls this
`scrollable-region-focusable`.

| site | now |
|---|---|
| `src/components/reports/ReportTable.jsx:97` | `tabIndex={0}` + `aria-label={ariaLabel}` |
| `src/dashboard/overview/DistributorOverview.jsx:345` | `aria-label="Top branches, scroll sideways to see more"` |
| `src/dashboard/overview/DistributorOverview.jsx:444` | `aria-label="Top agents, scroll sideways to see more"` |
| `src/admin-dashboard/overview/AdminOverview.jsx:377` | `aria-label="Top branches, scroll sideways to see more"` |

Each label reuses that card's own visible `.tableTitle` text, so the spoken name
matches what is on screen.

`ReportTable` has **14 call sites** and no title prop. Rather than edit all
fourteen — several of which sit in another agent's write-set this phase — it
gained an optional `ariaLabel` prop defaulting to plain-language copy
(*"Table, scroll sideways to see more"*, per the house no-jargon rule). Callers
can name their own table; nobody has to.

### Not changed, and why

`src/agent-dashboard/onboarding/OnboardFlow.jsx:75` — the onboarding `<ol>` the
finding also lists. Its `.stepper` class declares **no `overflow`**, so it is not
a scrollport and needs no `tabIndex`. It already carries
`aria-label="Onboarding progress"`. Adding focus here would insert a pointless
tab stop.

### Tests

`src/components/reports/scrollableRegion.contract.test.js` — a source-scanning
ratchet over every `styles.tableScroll` / `styles.quotesScroll` element in
`src/`, asserting each is focusable and named. Source-scanning deliberately: the
failure mode is *"someone adds a fifth scroll container and forgets"*, which no
test of the existing components can catch.

Proven to fail before the fix — one site reverted:

```
BEFORE: src/admin-dashboard/overview/AdminOverview.jsx:377 —
        not focusable (needs tabIndex={0}); no accessible name (needs aria-label)
        Tests  1 failed | 1 passed (2)
AFTER:  Tests  2 passed (2)
```

Plus two render assertions in `src/components/reports/ReportTable.test.jsx`
covering the default and caller-supplied names.
