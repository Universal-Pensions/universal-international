> **Agent guide.** Historical audit from March 29, 2025, covering a design QA review of the Distributor Admin dashboard — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# Design QA Report: Distributor Admin Dashboard
**Date**: March 29, 2025
**Reviewer**: Claude (Design QA Skill)
**Scope**: Full Distributor Admin dashboard — DashboardShell, Sidebar, OverlayPanel, TopBar, Breadcrumb, MetricsRow (Chat + Demographics cards)
**Source of truth**: `CLAUDE.md` design spec + WCAG 2.1 AA + platform touch target standards

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 6 |
| Medium | 6 |
| Low | 5 |
| **Total** | **19** |

**Overall assessment: Needs work before production.** The visual design language is strong and consistent — glassmorphism, indigo palette, typography hierarchy, and animation quality are all on-spec. The issues are concentrated in accessibility (missing labels, tiny touch targets, sub-minimum font sizes) and a few structural gaps that will matter at scale.

---

## Positive Observations

- Glassmorphism treatment is well-executed — backdrop blur, layered borders, and inset highlights are consistent across all cards
- Icon system is fully custom inline SVG with correct `strokeWidth="1.75"` throughout — matches the design spec exactly
- Framer Motion usage is appropriate: `ease-out-expo` on all enters, `AnimatePresence mode="wait"` for panel transitions, staggered card entrance
- Collapsible sections are smooth with animated height
- Mobile layout correctly uses safe area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`)
- Sidebar dark rail with teal active indicator is clean and on-brand
- Breadcrumb is well-styled and correctly hidden on mobile
- Chat `aria-live="polite"` is a good accessibility touch

---

## Critical Issues

### CRIT-01 — Chat input has no accessible label

**Location**: `MetricsRow.jsx:108` — ChatCard input field

**Expected** (WCAG 2.1 SC 1.3.1, 3.3.2):
Every form input must have a programmatically associated label — either a `<label for>` element, `aria-label`, or `aria-labelledby`.

**Actual**:
```jsx
<input
  className={styles.chatField}
  value={input}
  onChange={(e) => setInput(e.target.value)}
  placeholder="Ask about your data..."
/>
```
Placeholder text only. Screen readers will announce "edit text" with no description.

**Fix**: Add `aria-label="Ask about your data"` to the input.

**Impact**: Screen reader users cannot identify the field's purpose. Fails WCAG 2.1 AA.

---

### CRIT-02 — Text below 12px minimum in multiple locations

**Location**: `OverlayPanel.module.css` and `MetricsRow.module.css`

**Expected** (WCAG 2.1 SC 1.4.4; design system minimum for labels):
Smallest acceptable text in UI labels is 10px at the absolute floor, with body text at 12px+. The design spec sets `--text-xs` = 12px as the minimum token.

**Actual hardcoded sizes below token minimums**:

| Location | Selector | Size |
|----------|----------|------|
| Age axis labels | `.ageLabel` | **7px** |
| Count row labels | `.countLabel` | **8px** (desktop) |
| AUM / stat labels | `.aumLabel`, `.statLabel` | **9px** |
| Section headers | `.sectionTitle`, `.sectionCount`, `.statusPct` | 10px |
| Inactive tag | `.inactiveTag` | 9px |
| Expand subtitles | `.expandSubtitle`, `.expandLabel` | 9px |
| Chat suggestions | `.chatSuggest` | 9px (desktop) |
| Chat bubbles | `.chatBubble` | 10px (desktop) |

The **7px age axis labels** are functionally illegible at any screen density. Even 9px is below WCAG's practical minimum for sustained readability.

**Fix**: Age labels → 10px minimum. All label text → use `--text-xs` (12px) or at minimum 10px. Raw pixel values below 10px should not exist in this codebase.

**Impact**: Fails WCAG 1.4.4 (Resize Text) and 1.4.3 (Contrast). Illegible for users with any degree of visual impairment.

---

## High Priority Issues

### HIGH-01 — Multiple touch targets below 44×44px minimum

**Location**: Multiple components

**Expected** (Apple HIG, WCAG 2.5.5):
Minimum interactive touch target: 44×44px.

**Actual sizes**:

| Component | Element | Actual Size |
|-----------|---------|-------------|
| `OverlayPanel.module.css:383` | `.collapseBtn` | 28×28px |
| `MetricsRow.module.css:296` | `.chatSend` | 26×26px |
| `DashboardShell.module.css:62` | `.backBtn` (mobile) | 36×36px |
| `OverlayPanel.module.css:269` | `.entityBtn` (list rows) | ~28px height (padding `0.3rem`) |

**Fix**:
- `.collapseBtn`: increase to 44×44px (add padding, keep icon size)
- `.chatSend`: increase hit area to 44×44px (keep 26px icon, add `padding`)
- `.backBtn`: increase to 44×44px
- `.entityBtn`: increase vertical padding to `0.625rem` minimum

**Impact**: Primary tap interactions fail on mobile. Particularly bad for `.collapseBtn` which controls a core panel toggle and `.chatSend` which is the chat submission action.

---

### HIGH-02 — `aria-expanded` missing on all collapsible controls

**Location**: `OverlayPanel.jsx:38`, `MetricsRow.jsx:62`, `MetricsRow.jsx:200`

**Expected**:
All toggle buttons that expand/collapse content must declare `aria-expanded="true/false"`.

**Actual**:
```jsx
// CollapsibleSection — no aria-expanded
<button className={styles.sectionHeader} onClick={() => setOpen(!open)}>

// ChatCard — no aria-expanded
<button className={styles.chatHeader} onClick={onToggle} type="button">

// Demographics — no aria-expanded
<button className={styles.cardHeaderToggle} onClick={() => setDemoOpen(!demoOpen)} type="button">
```

**Fix**: Add `aria-expanded={open}` (or `{chatOpen}`, `{demoOpen}`) to each toggle button. Add `aria-controls` pointing to the collapsible region's id.

**Impact**: Screen reader users cannot determine the state of any collapsible section.

---

### HIGH-03 — Sidebar nav buttons use `title` instead of `aria-label`

**Location**: `Sidebar.jsx:175`

**Expected**:
Icon-only buttons must use `aria-label`. The `title` attribute is exposed inconsistently across screen readers and not read by default on all platforms.

**Actual**:
```jsx
<button ... title={item.label}>
```

**Fix**: Replace `title={item.label}` with `aria-label={item.label}`. Keep `title` for the visible tooltip if desired.

**Impact**: VoiceOver (iOS/macOS) may not read `title` for these buttons. Navigation is inaccessible to screen reader users.

---

### HIGH-04 — `height: 100vh` on sidebar and main container

**Location**: `Sidebar.module.css:6`, `DashboardShell.module.css:11`

**Expected**:
On iOS Safari, `100vh` includes the browser chrome, causing content to overflow or be obscured by the URL bar. Use `100dvh` (dynamic viewport height) instead.

**Actual**:
```css
/* Sidebar.module.css */
height: 100vh;

/* DashboardShell.module.css */
height: 100vh;
```

**Fix**: Replace both with `height: 100dvh`. Also update `max-height: calc(100vh - 16rem)` in `OverlayPanel.module.css:7` to `100dvh`.

**Impact**: On iPhone, the sidebar and main area may not fill the screen correctly, or content gets clipped under the browser chrome.

---

### HIGH-05 — Shell background uses hardcoded hex, not design token

**Location**: `DashboardShell.module.css:6`

**Expected**:
CLAUDE.md defines `--map-bg: #E8EAF0` as the map/shell background token.

**Actual**:
```css
background: #d5dae6;
```
`#d5dae6` is not in the design token system. It's perceptibly darker and more saturated than `--map-bg: #E8EAF0`, giving the shell a different feel than intended.

**Fix**: Replace with `background: var(--map-bg)`.

**Impact**: Off-brand background color that deviates from the design spec.

---

### HIGH-06 — Sidebar brand area shows placeholder SVG, not actual logo

**Location**: `Sidebar.jsx:158–163`

**Expected** (CLAUDE.md):
The sidebar has a dark indigo (`--color-indigo-deep`) background. CLAUDE.md specifies using `logo-white.png` (the greyed/brightened variant via CSS) on dark backgrounds.

**Actual**:
```jsx
<div className={styles.logo}>
  <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
    <path d="M12 2L2 7l10 5 10-5-10-5z" .../>  {/* Generic stack icon */}
    ...
  </svg>
</div>
```
A generic 3-layer stack SVG is used as the logo mark, not the actual Universal Pensions brand asset.

**Fix**: Replace with `<img src={logoWhite} alt="Universal Pensions" />` using `logo-white.png`. Apply `filter: brightness(2)` as the CLAUDE.md notes for dark backgrounds.

**Impact**: Brand misrepresentation on every dashboard session. Looks unfinished.

---

## Medium Priority Issues

### MED-01 — Greeting is hardcoded "Hi Admin"

**Location**: `OverlayPanel.jsx:124`

**Actual**:
```jsx
{level === 'country' && <h2 className={styles.greeting}>Hi Admin</h2>}
```

The `useApp` context has role/user info available. This should display the user's name or role (e.g. "Hi Sarah" or "Hi, Distributor Admin").

**Fix**: Pull the user's name or formatted role from `AppContext` and render it dynamically.

---

### MED-02 — Chat message area too small on desktop (max-height: 80px)

**Location**: `MetricsRow.module.css:209`

**Actual**:
```css
.chatMessages {
  max-height: 80px;
}
```
At 10px font size, this is approximately 4–5 lines. After 2–3 exchanges the user loses conversation context. The card is 340px wide — there's room to grow.

**Fix**: Increase to `max-height: 140px` on desktop. This allows a natural back-and-forth without the card becoming oversized.

---

### MED-03 — Bottom cards may overlap OverlayPanel at 1024px breakpoint

**Location**: `MetricsRow.module.css:2–8`, `OverlayPanel.module.css:3–6`

At a 1024px viewport:
- Sidebar: 64px
- Available content width: 960px
- OverlayPanel: 310px wide + 24px left offset = occupies up to 334px from left
- MetricsRow: positioned `right: var(--space-4)` (16px from right). Two cards × 340px + 12px gap = 692px from right edge = starts at 960 - 692 = 268px from left.

The panel's right edge (334px) overlaps with the cards' left start (268px) by ~66px.

**Fix**: Add a breakpoint at 1024px that reduces card width to `300px`, or reduces to a single column, or sets a `max-width` on the cards based on available space.

---

### MED-04 — MetricsRow renders 2 cards, not the 3-column grid in spec

**Location**: `MetricsRow.jsx:186`, `CLAUDE.md:88–91`

**Expected** (CLAUDE.md):
> "3-column grid (`repeat(3, 1fr)`) with `align-items: end`"
> "Card 3: Empty (reserved for future use)"

**Actual**:
```css
.row {
  display: flex;
  gap: var(--space-3);
  align-items: stretch;
}
```
Two cards in a flex row, not a 3-column grid. The third card slot is not rendered. The `align-items: stretch` differs from the spec's `align-items: end`.

**Fix**: Change to `display: grid; grid-template-columns: repeat(3, 340px); align-items: end;`. Add a placeholder third card or empty div to preserve the layout rhythm.

---

### MED-05 — OverlayPanel top position uses magic number

**Location**: `OverlayPanel.module.css:3`

**Actual**:
```css
top: calc(var(--space-6) + 2.5rem);
```
The `2.5rem` is an undocumented magic number compensating for the Breadcrumb height. If the breadcrumb height changes, this breaks silently.

**Fix**: Give the Breadcrumb a known fixed height (e.g. `--breadcrumb-height: 40px`) as a CSS custom property, and reference it here: `top: calc(var(--breadcrumb-height) + var(--space-4))`.

---

### MED-06 — No loading state for map GeoJSON

**Location**: `UgandaMap.jsx` (based on Leaflet + `uganda-topo.json`)

The map loads GeoJSON from `public/uganda-topo.json` asynchronously. There is no skeleton, shimmer, or spinner shown while the tileset and GeoJSON load. On slow connections, users see a blank or partially rendered map.

**Fix**: Add a loading state with a simple placeholder (e.g. the `--map-bg` fill with a centered spinner or pulsing skeleton overlay) until the GeoJSON resolves.

---

## Low Priority Issues

### LOW-01 — Missing `type="button"` on buttons outside forms

**Location**: `TopBar.jsx:6,11`; several other interactive buttons across the dashboard

HTML buttons inside non-form contexts default to `type="submit"` which can cause accidental form submissions in future refactors. Buttons should explicitly declare `type="button"`.

**Fix**: Add `type="button"` to all dashboard buttons that are not form submits.

---

### LOW-02 — Chat suggestion pills can't be recalled after first message

**Location**: `MetricsRow.jsx:94`

```jsx
{messages.length <= 1 && (
  <div className={styles.chatSuggestions}>...
```
Once the user sends any message, the suggestions are permanently gone. If the user wants to use a suggestion later, there's no path back.

**Fix**: Show suggestions again when the chat is cleared, or keep a collapsed "Suggestions" row below the input that can be toggled.

---

### LOW-03 — Demographics "Details" button label is ambiguous

**Location**: `MetricsRow.jsx:217`

```jsx
<button className={styles.detailsBtn} onClick={() => toggleExpand('demographics')}>
  {expanded === 'demographics' ? 'Collapse' : 'Details'}
</button>
```
"Details" and "Collapse" don't communicate what will happen. "Details" could mean "more info about the card" or "full breakdown". Also missing `aria-expanded`.

**Fix**: Use "Expand" / "Collapse" or "Show counts" / "Hide counts" for clarity. Add `aria-expanded={expanded === 'demographics'}`.

---

### LOW-04 — Dead code: StatusBar component never used

**Location**: `OverlayPanel.jsx:62–73`

```jsx
function StatusBar({ label, value, segments }) { ... }
```
This component is defined but never referenced in the JSX. The entity list rows use a different pattern (name + subscriber count, no bar).

**Fix**: Remove the `StatusBar` component.

---

### LOW-05 — Dead code: Mobile tab bar in Sidebar is permanently hidden

**Location**: `Sidebar.jsx:219–272`, `Sidebar.module.css:90–92`

The `MOBILE_NAV` array, `.mobileBar`, `.mobileBtn`, `.mobileLabel`, and `.moreWrap` elements are all rendered in the JSX but the CSS permanently hides them (`display: none` with no override), and the entire sidebar is hidden on mobile anyway (`display: none` at ≤768px). The mobile tab bar was replaced by the hamburger drawer in DashboardShell but the dead JSX and CSS remain.

**Fix**: Remove `MOBILE_NAV`, `mobileBar`, `mobileBtn`, `mobileLabel`, `moreWrap` JSX and their corresponding CSS classes, and `MORE_ITEMS` array.

---

## Recommendations (Priority Order)

1. **Accessibility pass** — Address CRIT-01 (input label), CRIT-02 (font sizes), HIGH-02 (aria-expanded), HIGH-03 (aria-label on sidebar). These are WCAG AA compliance issues.
2. **Touch targets** — HIGH-01. Fix the 4 undersized targets before any mobile testing.
3. **100vh → 100dvh** — HIGH-04. One-line fix per file, high impact on iOS.
4. **Logo + background token** — HIGH-05, HIGH-06. Branding and token consistency.
5. **Card layout at 1024px** — MED-03. Add a responsive breakpoint before the cards overlap.
6. **MetricsRow grid** — MED-04. Align implementation with the 3-column spec.
7. **Dead code cleanup** — LOW-04, LOW-05. Reduces confusion during future development.

## Next Steps

- [ ] Fix CRIT-01 and CRIT-02 (accessibility — do not ship without these)
- [ ] Fix HIGH-01 through HIGH-04 (touch targets, aria-expanded, 100dvh)
- [ ] Replace placeholder sidebar logo (HIGH-06)
- [ ] Fix shell background token (HIGH-05)
- [ ] Schedule follow-up QA after fixes for MED-01 through MED-06
