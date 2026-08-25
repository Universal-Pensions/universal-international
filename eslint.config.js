import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

// jsx-a11y recommended ruleset (34 rules), split three ways against the
// CURRENT violation census (measured 2026-08-25 on `src/**/*.jsx`; see
// docs/audits/2026-08-23 A25-009 / A20-007 / A20-008):
//
//   1. DEPRECATED — `label-has-for`'s own rule meta (verified against the
//      installed eslint-plugin-jsx-a11y@6.10.2 source) is
//      `{ deprecated: true, replacedBy: ['label-has-associated-control'] }`.
//      It fires on 137 of the repo's ~331 warnings — effectively every
//      `<label>` — because it demands BOTH nesting AND an id, a stricter
//      shape than any of these forms actually need.
//      `label-has-associated-control` (kept below, case 2) is the
//      maintained successor and already enforces the real invariant ("a
//      label has SOME associated control"). Turned fully OFF rather than
//      left at 'warn': keeping a deprecated rule alive just to manufacture
//      noise doesn't serve the backlog it's supposedly tracking. (A20-007)
//   2. HAS EXISTING VIOLATIONS — left at 'warn'. Promoting these to 'error'
//      would fail `npm run lint` today on component files this lint/types
//      pass has no write access to fix (out of scope here; see A20-008 for
//      why `aria-role`'s 10 hits are a false-alarm prop-name collision, not
//      real invalid ARIA roles, and A20-007 for the label pair above).
//   3. ZERO current hits — promoted to 'error'. Regression ratchet: this
//      set cannot grow; the warn-only backlog above can only shrink into it
//      as files get fixed.
const JSX_A11Y_ALL_RECOMMENDED = Object.keys(jsxA11y.flatConfigs.recommended.rules) // 34, 'jsx-a11y/xxx' form

const JSX_A11Y_DEPRECATED_OFF = ['jsx-a11y/label-has-for']

const JSX_A11Y_HAS_VIOLATIONS_WARN = [
  'jsx-a11y/control-has-associated-label', // 140 hits
  'jsx-a11y/label-has-associated-control', // 8 hits
  'jsx-a11y/aria-role', // 10 hits — all 10 are NotificationBell's `role` PROP (React prop, not a DOM ARIA role); see A20-008.
  'jsx-a11y/no-autofocus', // 6 hits
  'jsx-a11y/anchor-is-valid', // 4 hits
  'jsx-a11y/no-noninteractive-element-to-interactive-role', // 3 hits
  'jsx-a11y/interactive-supports-focus', // 2 hits
  'jsx-a11y/no-noninteractive-tabindex', // 2 hits
  'jsx-a11y/no-static-element-interactions', // 1 hit
]

const jsxA11yWarnRules = Object.fromEntries(
  JSX_A11Y_HAS_VIOLATIONS_WARN.map((rule) => [rule, 'warn'])
)
const jsxA11yErrorRules = Object.fromEntries(
  JSX_A11Y_ALL_RECOMMENDED
    .filter((rule) => !JSX_A11Y_DEPRECATED_OFF.includes(rule) && !JSX_A11Y_HAS_VIOLATIONS_WARN.includes(rule))
    .map((rule) => [rule, 'error'])
)
const jsxA11yOffRules = Object.fromEntries(JSX_A11Y_DEPRECATED_OFF.map((rule) => [rule, 'off']))

// A26-005 — mechanical enforcement for CLAUDE.md §4/§5 rules that are AST
// patterns (import boundaries, call-site shapes). Both scoped to zero
// CURRENT violations (verified 2026-08-25 — the architecture already holds
// by convention; these two rules just make a future regression fail the
// build instead of relying on review). Literal-string invariants (auth /
// signup storage keys, hardcoded endpoints, CSS patterns, migration text)
// are enforced instead by grep-based contract tests under src/test/ —
// following the src/test/login-identity-contract.test.js /
// jwt-claim-contract.test.js precedent already in this repo, since ESLint
// has no visibility into CSS or SQL migration files. See
// docs/audits/2026-08-23 A26-005 for the full 13-rule enforceability table.
const CLAUDE_MD_MOCKDATA_BOUNDARY = {
  files: ['src/**/*.{js,jsx}'],
  ignores: ['src/data/**', 'src/services/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/data/mockData', '**/data/mockData.js', '**/mockData', '**/mockData.js'],
        message:
          "CLAUDE.md §4.1/§5.1: components and dashboard files must never import "
          + 'src/data/mockData.js directly. Read it via a hook in src/hooks/ backed '
          + 'by a service in src/services/ — only service files may import mockData.',
      }],
    }],
  },
}
const CLAUDE_MD_NO_HANDROLLED_FETCH = {
  files: ['src/**/*.{js,jsx}'],
  ignores: ['src/services/**'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "CallExpression[callee.name='fetch'] > Literal[value=/^\\/api\\//]",
      message:
        "CLAUDE.md §5.2: don't hand-roll fetch() against /api/* — use services/api.js "
        + '(api.get/post/put/delete) so the shared 401 listener (onAuthExpired) fires.',
    }, {
      selector:
        "CallExpression[callee.name='fetch'] > TemplateLiteral > TemplateElement[value.raw=/^\\/api\\//]",
      message:
        "CLAUDE.md §5.2: don't hand-roll fetch() against /api/* — use services/api.js "
        + '(api.get/post/put/delete) so the shared 401 listener (onAuthExpired) fires.',
    }],
  },
}

export default defineConfig([
  globalIgnores([
    'dist', 'dist-server', 'coverage', '.claude/worktrees/**', 'playwright-report/**', 'test-results/**',
    // A25-010 — flat config doesn't read .gitignore, so these untracked/
    // scratch trees (both already .gitignore'd) were being linted anyway:
    // 194 docs/** result entries + 3 .understand-anything/** in the
    // 2026-08-25 baseline, none of them part of the shipped project. With
    // no-unused-vars at 'error', a stray scratch file could fail the gate
    // on its own.
    'docs/**', '.understand-anything/**',
  ]),
  // jsx-a11y baseline — scoped to React source only (§7c.6 / A25-009 / A20-007).
  {
    files: ['src/**/*.jsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: { ...jsxA11yWarnRules, ...jsxA11yErrorRules, ...jsxA11yOffRules },
  },
  CLAUDE_MD_MOCKDATA_BOUNDARY,
  CLAUDE_MD_NO_HANDROLLED_FETCH,
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ── react-hooks: the React-Compiler rules, censused 2026-08-25 ─────────
      // `reactHooks.configs.flat.recommended` sets these to 'error'. Four of
      // them arrived with an IN-RANGE plugin bump (package.json pins
      // ^7.0.1 on this branch AND on main; 7.1.1 resolves), so `npm run lint`
      // — which CI runs — started exiting 1 on code nobody had touched. 12 of
      // the 16 affected files are untouched by the audit-remediation branch.
      //
      // Handled by the SAME policy this file already applies to jsx-a11y
      // above: a rule with existing violations goes to 'warn' and is counted;
      // a rule at zero hits stays 'error' as a ratchet. The counts below are
      // the backlog — they may shrink, never grow, and --max-warnings in
      // package.json is the gate that enforces it.
      //
      // These are NOT cosmetic. `set-state-in-effect` in particular flags a
      // real double-render pattern. They are deferred, not dismissed: fixing
      // 16 of them across 12 files is a genuine hooks refactor with regression
      // risk, and it is not the same task as un-breaking CI.
      'react-hooks/set-state-in-effect': 'warn',          // 16 hits, 12 files
      'react-hooks/immutability': 'warn',                 //  2 hits,  2 files
      'react-hooks/refs': 'warn',                         //  1 hit
      'react-hooks/preserve-manual-memoization': 'warn',  //  1 hit
      // Every other react-hooks rule — including rules-of-hooks and
      // exhaustive-deps — stays at the plugin's 'error'.

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]|^motion$', destructuredArrayIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', {
        allowConstantExport: true,
        allowExportNames: [
          'useAdminPanel',
          'useAgentScope',
          'useAuth',
          'useBranchScope',
          'useDashboard',
          'useDashboardNav',
          'useDashboardPanel',
          'useDataScope',
          'useEmployerScope',
          'useEmployerPanel',
          'useSignIn',
          'useSignup',
          'useSubscriberPanel',
          'useToast',
          'useApp',
          'useWarmup',
          'STEPS',
          'AGENT_STEP',
          'PENDING_REVIEW_STEP',
          'getStepIndex',
        ],
      }],
    },
  },
])
