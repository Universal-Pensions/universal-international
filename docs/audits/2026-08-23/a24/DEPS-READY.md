# Dependency advisories — measured, and why they are not fixed yet

**Measured 2026-08-25** against the lockfile and `node_modules`, not against the audit's text.

| package | installed | fixed in | declared range | in range? | advisory |
|---|---|---|---|---|---|
| `react-router` / `react-router-dom` | **7.17.0** | 7.18.2 | `^7.15.1` | **yes** | 5 advisories incl. one HIGH (A24-004) |
| `vite` | **6.4.2** | 6.4.3 | `^6.4.2` | **yes** | GHSA-fx2h-pf6j-xcff |
| `concurrently` | **9.2.1** | 9.2.4 | `^9.2.1` | **yes** | shell-quote, CRITICAL |

## The useful finding: no `package.json` edit is required

All three fixes sit **inside the already-declared semver ranges**. So this is a
**lockfile-only** change:

```bash
npm update react-router react-router-dom vite concurrently
```

That is materially easier than the audit implies. A24-004/A24-006 both frame the fix as "merge
Dependabot PR #35", which also drags in unrelated churn and is wedged behind a red lint gate
(A09-008). The three in-range advisories can be cleared without touching that PR at all.

## Why it is not done in this pass

`package.json` and `package-lock.json` currently hold the **user's own uncommitted work** — the
`@axe-core/playwright` devDependency they installed before this programme started. Running
`npm update` would interleave my lockfile changes with theirs in the same file, and this
programme's standing rule is to commit by explicit path and never absorb the user's WIP into a
commit of mine.

**Owner: `P6-deps` (Phase 6)**, which owns `package.json`. It must:

1. Confirm with the user before touching the lockfile, or wait until their WIP is committed.
2. Run the `npm update` above — lockfile only.
3. Re-verify the installed versions afterwards (`node -e "require('./node_modules/vite/package.json').version"`),
   not just the lockfile text.
4. Run the full unit suite and `npx vite build` — a router minor bump touches every route.

## Sequencing note

The plan sequences this as **Phase 5 stage 0**: "react-router 7.18.2 bump lands **before**
`P5-nav-shells` touches routing." `P5-nav-shells` has not started, so the ordering is still
intact — but if Phase 5's routing work lands first, the bump becomes a change on top of freshly
rewritten shells rather than under them, which is the harder order to debug.

## Not in scope here

A09-008 (Dependabot alerts disabled; 12 PRs wedged behind a red lint gate) and the 12 major-version
PRs are separate, and majors need individual triage — they are not covered by the in-range update
above.
