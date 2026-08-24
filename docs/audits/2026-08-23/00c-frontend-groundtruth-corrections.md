# Phase 0 addendum — frontend ground-truth corrections

Measured 2026-08-23 by A00. **Two of the audit plan's §5 frontend claims are wrong.** Phase 4 and
Phase 5 agents must use the figures here, not the plan's.

## 1. `role="agent"` is a FALSE POSITIVE — it is a prop, not an ARIA role

The plan (§5 a11y signals, and A20 check 3) states there is *"an invalid `role="agent"` ×4"* and asks
A20 to "locate and report" it. **There is no invalid ARIA role.**

`NotificationBell` declares `role` as an ordinary React prop meaning *recipient role*:
```
src/components/notifications/NotificationBell.jsx:49    role,
src/components/notifications/NotificationBell.jsx:61    const { data: unread = 0 } = useUnreadNotificationCount({ role, entityId });
src/components/notifications/NotificationBell.jsx:121   <NotificationList role={role} entityId={entityId} onClose={close} />
```
The only `role` it ever renders to the DOM is **`role="region"`** (line 114) — valid ARIA.

The three call sites pass a *prop*, not an attribute:
```
src/agent-dashboard/shell/AgentDesktopShell.jsx:134   <NotificationBell role="agent" entityId={agentId} align="right" portal />
src/agent-dashboard/shell/AgentMobileAppBar.jsx:115   <NotificationBell role="agent" entityId={agentId} align="right" />
src/agent-dashboard/shell/SideNav.jsx:103             <NotificationBell role="agent" entityId={agentId} align="left" />
```
(the 4th "site" the plan counted is a **comment** at `NotificationBell.jsx:27`.)

**Correct finding:** not an a11y defect. It is a **prop-name collision with the ARIA attribute name**
that makes `jsx-a11y/aria-role` fire. Severity **Low/Info** (lint noise), not an a11y blocker.
The real cost is that this noise sits inside the 10 `jsx-a11y/aria-role` warnings and can mask a
genuine invalid role elsewhere.

**A20 must therefore:** enumerate all **10** `jsx-a11y/aria-role` warnings, separate the ~3 caused by
this prop collision from any genuine invalid roles in the remaining ~7, and report only the genuine
ones as a11y defects. Suggested fix for the collision (do not apply): rename the prop to
`recipientRole`.

## 2. Locale drift is real, but larger and differently distributed than the plan says

| Locale | Plan claim | **Measured** | Where |
|---|---|---|---|
| `en-GB` | ~5 admin files | **5** ✅ | all admin date formatters |
| `en-US` | ~2 branch files | **5** ❌ | 2 branch + 1 test + **2 landing** |
| direct `en-UG` bypassing the util | ~7 | **18** ❌ | across admin, signup, utils |
| `Africa/Kampala` | absent | **0** ✅ | confirmed absent everywhere |

### The worst site the plan missed: the public landing page formats money as `en-US`
```
src/pages/landing/SubscribersPage.jsx:55   const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');
src/pages/landing/mobile/calc.js:19        export const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');
```
This is **hardcoded `'UGX '` string concatenation plus a US locale**, on the savings calculator of the
**public landing page** — the first money figure a prospect ever sees, and the one surface that is not
behind a login. It bypasses `src/utils/currency.js` entirely. A23 should treat this as its headline
currency finding.

### The canonical constant is itself duplicated
`LOCALE = 'en-UG'` is declared **twice**, independently:
```
src/utils/currency.js:16   const LOCALE = 'en-UG';
src/utils/date.js:11       const LOCALE = 'en-UG';
```
Nothing keeps them in step — the same class of drift the plan flags for `--ease-out-expo`.

### `en-GB` sites (all admin, all dates)
```
src/admin-dashboard/attention/AdminAttentionDesktop.jsx:43
src/admin-dashboard/nav/AdminNavDesktop.jsx:65, :71
src/admin-dashboard/attention/AdminAttentionMobile.jsx:22
src/admin-dashboard/mobile/AdminNavMobile.jsx:33
```

## 3. Confirmed as the plan stated (no correction needed)

| Claim | Measured | Verdict |
|---|---|---|
| `useIsDesktop` = 1024 px | `(min-width: 1024px)`, 74 files | ✅ (plan said 72) |
| `useIsMobile` = 768 px | `(max-width: 768px)`, 21 files | ✅ |
| **769–1023 px is neither** | confirmed by the two queries above | ✅ real gap |
| `BottomSheet` ×5 | 5 `.jsx` + 5 `.module.css` | ✅ agent, branch, employer, landing, subscriber |
| `ReportTable`/`FilterSelect`/`SearchFilter` ×2 | 2 each | ✅ `src/components/reports/` vs `src/dashboard/reports/` |
| 19 `role="dialog"` | **19** | ✅ |
| 21 `aria-modal` | **21** | ✅ |
| **no focus-trap utility** | **0 files** match focusTrap/FocusTrap/focus-trap | ✅ confirmed absent |
| 20 `aria-live` | **20** | ✅ |
| `src/index.css` 332 lines | **332** | ✅ |
| 82 custom properties | **87** | ⚠️ minor — plan undercounted by 5 |
