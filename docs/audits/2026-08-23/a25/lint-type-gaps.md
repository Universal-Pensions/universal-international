### 3.1 `api/`, `server/`, `e2e/` TypeScript is not linted at all

`eslint.config.js` has exactly two config objects with `rules`. Their `files` globs are
`['src/**/*.jsx']` and `['**/*.{js,jsx}']`. **No block matches `.ts`/`.tsx`**, and ESLint 9's flat
config only lints extensions a config claims. Measured:

```
$ npx eslint . --format json | node -e '…count by ext / by top dir…'
files linted: 684
by ext: {"cjs":3,"mjs":68,"js":180,"jsx":433}
by top dir: {".understand-anything":3,"docs":63,"eslint.config.js":1,"public":1,
             "scripts":5,"src":610,"vite.config.js":1}
```

Zero `.ts` files. The unlinted population:

| Directory | `.ts`/`.tsx` files | Linted |
|---|---|---|
| `api/` | 48 | **0** |
| `e2e/` | 46 | **0** |
| `server/` | 5 | **0** |
| `playwright.config.ts` | 1 | **0** |
| **total** | **100** | **0** |

Two second-order consequences fall out of the same measurement:

1. `no-unused-vars`, `no-console` (the config allows only `warn`/`error`) and
   `react-hooks/*` never run over the entire backend and the entire test harness.
2. `eslint .` **does** lint 66 files that are untracked or `.gitignore`d
   (`docs/**` 63, `.understand-anything/**` 3 — the latter is literally on `.gitignore:74`).
   Flat config does not read `.gitignore`, and `globalIgnores([...])` lists only
   `dist, dist-server, coverage, .claude/worktrees, playwright-report, test-results`.
   Today those 66 files contribute 0 problems, so `npm run lint` still reports the baseline
   `0 errors, 323 warnings` — I re-ran it to confirm. But `no-unused-vars` is configured as
   **`error`**, so a single stray untracked scratch `.mjs` with an unused variable would fail
   `npm run lint` — the gate's result depends on files that are not part of the project.

**Remedy (concrete):** add a third flat-config block

```js
{ files: ['api/**/*.ts', 'server/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
  languageOptions: { parser: tseslint.parser, globals: globals.node },
  plugins: { '@typescript-eslint': tseslint.plugin },
  extends: [tseslint.configs.recommended],
  rules: { 'no-console': 'off' } }        // server logging is intentional
```
plus `globalIgnores(['docs/**', '.understand-anything/**'])` — or, better,
`includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url)))` from
`@eslint/compat`, so the lint scope tracks the repo's own ignore rules.

### 3.2 There is no `typecheck` script; `tsc` covers 32 of 100 `.ts` files

`package.json` has no `typecheck`. The only `tsc` invocation is
`"build:api": "tsc -p server/tsconfig.json"`, and that project **excludes** the tests:

```jsonc
"include": ["../api/**/*.ts", "./**/*.ts"],
"exclude": ["../node_modules/**", "../dist/**",
            "../api/**/*.test.ts", "../api/**/*.spec.ts", "./**/*.test.ts"]
```

Measured with `--listFiles`, tsc walks exactly **32 files** (27 `api/` + 5 `server/`). What is
never type-checked:

| Never type-checked | Count |
|---|---|
| `api/**/*.test.ts` (excluded by tsconfig) | 21 |
| `e2e/**/*.ts` (outside `include`; Playwright transpiles with esbuild, no checking) | 46 |
| `playwright.config.ts` | 1 |
| **total** | **68 of 100** |

There is also **no root `tsconfig.json`** (`ls tsconfig*` → no matches), so nothing at all — not
even `checkJs` — looks at `src/`.

**Remedy:** add `e2e/tsconfig.json` (`extends` the server one, `include: ["**/*.ts", "../playwright.config.ts"]`,
`types: ["node"]`), add `"typecheck": "tsc -p server/tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit"`,
drop the `*.test.ts` excludes (they are `--noEmit` now), and run `npm run typecheck` in the
`lint-and-unit` CI job so a broken spec type fails at PR time rather than never.

### 3.3 No stylelint, no import-boundary rule, no pre-commit hooks

```
$ ls -a | grep -iE "stylelint|prettier|husky|lint-staged"   → (nothing)
$ ls -1 .git/hooks/ | grep -v sample                        → (nothing)
```

229 `.module.css` files ship with no linter: nothing enforces the design-token contract
(`var(--color-indigo)` vs a raw hex), no duplicate-selector or unknown-property check, no
ordering. Nothing prevents `src/subscriber-dashboard/**` from importing
`src/admin-dashboard/**` either — there is no `import/no-restricted-paths`, no
`eslint-plugin-boundaries`, and no `no-restricted-imports` entry, even though the codebase is
explicitly organised into six per-role trees plus shared `src/{components,hooks,services,utils}`.

**Remedy:** (a) `stylelint` + `stylelint-config-standard` with a
`declaration-property-value-allowed-list` for `color`/`background` restricted to `var(--…)`;
(b) an `import/no-restricted-paths` zone set that forbids cross-role imports and allows only the
shared trees; (c) `husky` + `lint-staged` running `eslint --fix` on staged `{js,jsx,ts}` and
`stylelint --fix` on staged `css`. None of these can be added as a blocking gate today without
first burning down the existing warning backlog — so ship them as `--max-warnings` ratchets.

### 3.4 Every `jsx-a11y` rule is forced to `warn`, and `lint` has no `--max-warnings`

```js
const jsxA11yWarnRules = Object.fromEntries(
  Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn'])
)
```

with `"lint": "eslint ."` — no `--max-warnings`. A00 measured 323 warnings, 311 of them
`jsx-a11y` (96 %), and `npm run lint` still exits 0. The backlog is therefore not merely
unenforced, it is **unbounded**: a PR may add 50 more `jsx-a11y` warnings and CI stays green.

**Remedy:** two steps, both cheap. (1) Pin the ceiling today —
`"lint": "eslint . --max-warnings=323"` — which converts the backlog into a ratchet that can only
shrink. (2) Promote to `error` the **25 of 34** `jsx-a11y` recommended rules that have zero current
violations (measured: the plugin's `flatConfigs.recommended` carries 34 rules; A00's histogram
shows hits for only 9 of them — `alt-text`, `aria-props`, `img-redundant-alt`,
`role-supports-aria-props`, `tabindex-no-positive` and 20 others are all at 0), leaving only the 9
rules that actually have hits at `warn`. That makes new classes of a11y defect a hard failure while the historical 311
burn down.
