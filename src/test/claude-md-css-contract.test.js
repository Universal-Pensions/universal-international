// CLAUDE.md §5.3 / §5.4 enforcement — CSS anti-patterns. There is no
// stylelint config in this repo (adding one is a dependency this task is
// not permitted to introduce — see docs/audits/2026-08-23 A25-008/A26-005),
// so these run as plain grep/parse contract tests instead, same shape as
// the migration-text checks elsewhere in this directory.
//
// §5.4 ("Don't write `transition: all`") is zero-tolerance: verified
// 2026-08-25, every CURRENT match is inside a comment (the 3 hits the audit
// found are all `/* ... transition: all ... */` citations of this very
// rule). Any real declaration fails immediately.
//
// §5.3 ("Don't write outline: none without a :focus-visible replacement")
// is a RATCHET, not zero-tolerance: a rule-aware parse (below) — not a bare
// grep, which over- and under-counts this one badly — found 3 genuine
// pre-existing violations. Fixing them means editing those three CSS
// modules, which is outside this task's write-set (config files + new
// tests only), so this test pins today's count as a ceiling: it fails only
// if the count GROWS, and prints exactly which selectors are new so the fix
// is a diff away next time someone's write-set includes src/**/*.css.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../..');

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function walkCss(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkCss(full, out);
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split('\\').join('/');
}

/**
 * Brace-depth-aware CSS parse into a flat list of { selector, body } for the
 * innermost rule blocks, descending through @media/@supports wrappers
 * (their own "selector" — the at-rule prelude — is dropped; only their
 * nested rules are kept).
 */
function parseRules(css) {
  const rules = [];
  let i = 0;
  const n = css.length;
  let bufStart = 0;
  while (i < n) {
    if (css[i] === '{') {
      const selector = css.slice(bufStart, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      const bodyFull = css.slice(i + 1, j - 1);
      if (selector.startsWith('@')) {
        rules.push(...parseRules(bodyFull));
      } else {
        rules.push({ selector, body: bodyFull });
      }
      i = j;
      bufStart = i;
    } else {
      i += 1;
    }
  }
  return rules;
}

const allCssFiles = walkCss(SRC_DIR);

describe('CSS contract (CLAUDE.md §5.3 / §5.4)', () => {
  it('discovers CSS files to scan', () => {
    expect(allCssFiles.length).toBeGreaterThan(50);
  });

  it('src/index.css defines the global :focus-visible baseline the rule refers to', () => {
    const css = stripCssComments(readFileSync(resolve(SRC_DIR, 'index.css'), 'utf8'));
    const rules = parseRules(css);
    const hasGlobalBaseline = rules.some((r) => /:focus-visible/.test(r.selector));
    expect(
      hasGlobalBaseline,
      'CLAUDE.md §5.3 says "Global :focus-visible baseline lives in src/index.css" — ' +
        'that rule no longer holds; every bare `outline: none` in a component CSS ' +
        'module now has nothing to fall back on.',
    ).toBe(true);
  });

  it('§5.4 — no real `transition: all` declaration exists (comments citing the rule are fine)', () => {
    const offenders = [];
    for (const file of allCssFiles) {
      const css = stripCssComments(readFileSync(file, 'utf8'));
      if (/transition\s*:\s*all\b/i.test(css)) {
        offenders.push(relPath(file));
      }
    }
    expect(
      offenders,
      `${offenders.length} file(s) declare \`transition: all\` for real (CLAUDE.md §5.4 — ` +
        `always enumerate properties):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  describe('§5.3 — outline:none inside :focus-visible/:focus/:focus-within needs a replacement indicator', () => {
    const FOCUS_PSEUDO = /:focus(-visible|-within)?\b/;
    const OUTLINE_NONE = /\boutline\s*:\s*(none|0)\b/i;
    const INDICATOR_PROPS = /\b(box-shadow|border(-color|-width|-style)?|background(-color)?|filter|color)\s*:/i;

    // 2026-08-25 baseline — see the file header. Each is a container that
    // receives focus PROGRAMMATICALLY (an a11y "announce this" focus
    // target after a step/submit transition), not a persistent interactive
    // control, which is presumably why these slipped through review — but
    // the rule as written doesn't carve that out, so they count.
    const KNOWN_VIOLATIONS = new Set([
      'src/components/InlinePayPanel.module.css::.panel:focus,\n.successInner:focus',
      'src/pages/NomineeClaim.module.css::.done:focus-visible',
      'src/signup/SignupShell.module.css::.bodyInner:focus',
    ]);

    function findViolations() {
      const found = [];
      for (const file of allCssFiles) {
        const css = stripCssComments(readFileSync(file, 'utf8'));
        const rules = parseRules(css);
        for (const { selector, body } of rules) {
          if (!FOCUS_PSEUDO.test(selector) || !OUTLINE_NONE.test(body)) continue;
          if (INDICATOR_PROPS.test(body)) continue; // has its own replacement
          const base = selector.replace(new RegExp(FOCUS_PSEUDO, 'g'), '').trim();
          const covered = rules.some((r2) => {
            if (r2.selector === selector) return false;
            const base2 = r2.selector.replace(new RegExp(FOCUS_PSEUDO, 'g'), '').trim();
            if (base2 === base && INDICATOR_PROPS.test(r2.body)) return true; // sibling pseudo (e.g. :focus + :focus-visible) provides it
            if (r2.selector.startsWith(`${selector} `) && INDICATOR_PROPS.test(r2.body)) return true; // descendant carries it
            return false;
          });
          if (!covered) {
            found.push({ key: `${relPath(file)}::${selector}`, file: relPath(file), selector });
          }
        }
      }
      return found;
    }

    it('genuine violation count has not grown past the documented baseline', () => {
      const found = findViolations();
      const foundKeys = new Set(found.map((v) => v.key));
      const newOnes = found.filter((v) => !KNOWN_VIOLATIONS.has(v.key));
      const goneOnes = [...KNOWN_VIOLATIONS].filter((k) => !foundKeys.has(k));

      if (goneOnes.length) {
        // A violation was fixed — shrink KNOWN_VIOLATIONS to match so the
        // ratchet only ever tightens.
        // eslint-disable-next-line no-console
        console.log(
          `§5.3 contract: ${goneOnes.length} previously-known violation(s) no longer ` +
            `reproduce — remove from KNOWN_VIOLATIONS: ${goneOnes.join(', ')}`,
        );
      }
      expect(
        newOnes.map((v) => `${v.file}  |  ${v.selector.replace(/\n/g, ' ')}`),
        `${newOnes.length} NEW outline:none-without-replacement violation(s) ` +
          '(CLAUDE.md §5.3). Add a :focus-visible box-shadow/border/filter ' +
          'replacement, or a companion :focus-within on the wrapping element.',
      ).toEqual([]);
    });
  });
});
