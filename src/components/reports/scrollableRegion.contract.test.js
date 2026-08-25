// A20-005 — scrollable data tables must be keyboard-accessible.
//
// A container with `overflow-x: auto` can be scrolled with a mouse or a finger
// but NOT with a keyboard, unless it is focusable. Axe calls this
// `scrollable-region-focusable`. For a wide report table that is not cosmetic:
// the columns past the fold are simply unreachable without a pointer.
//
// The landing pages' `.quotesScroll` containers already got this right
// (tabIndex={0} + aria-label). The shared `.tableScroll` shell did not, at four
// sites. This is the ratchet that keeps a fifth from appearing.
//
// Source-scanning rather than rendering, deliberately: the defect is "somebody
// added a new scroll container and forgot", which no amount of testing the
// EXISTING components can catch.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same path convention as src/test/money-write-rpc-contract.test.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../..');

// Class names whose CSS declares an overflow that makes the element a scrollport.
const SCROLL_CLASSES = ['tableScroll', 'quotesScroll'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    // Skip macOS folder-sync conflict copies ("foo 2.js"). This checkout
    // lives under ~/Desktop and its sync process duplicates files during
    // branch switches; a directory walk otherwise scans the copies, and a
    // contract test then reports its OWN duplicate as a violation. Same
    // exclusion vite.config.js already applies to coverage.
    if (/ \d+\.[A-Za-z0-9]+$/.test(entry)) continue;
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('A20-005 — scrollable regions are keyboard-reachable', () => {
  const files = walk(SRC);

  for (const cls of SCROLL_CLASSES) {
    it(`every styles.${cls} container is focusable and named`, () => {
      const offenders = [];

      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes(`styles.${cls}`)) continue;

        // Each JSX element that carries the class, up to its closing '>'.
        const re = new RegExp(`<[a-zA-Z][^>]*styles\\.${cls}[^>]*>`, 'g');
        for (const match of src.match(re) || []) {
          const focusable = /tabIndex=\{0\}/.test(match);
          const named = /aria-label=/.test(match);
          // role="region" is REQUIRED, not decorative. ARIA prohibits
          // aria-label on a generic element, so browsers DISCARD it: a
          // <div tabIndex={0} aria-label="..."> with no role is a focusable
          // element that announces NOTHING. This test previously checked only
          // the first two conditions, so it ratcheted that exact broken shape
          // in — and would have rejected a correct fix. The codebase already
          // uses role="region" properly in 20+ places (NotificationBell,
          // UgandaMap, Toast).
          const roled = /role="(region|group)"/.test(match);
          if (!focusable || !named || !roled) {
            const line = src.slice(0, src.indexOf(match)).split('\n').length;
            offenders.push(
              `${file.replace(SRC + '/', 'src/')}:${line} — ` +
                [
                  !focusable && 'not focusable (needs tabIndex={0})',
                  !named && 'no accessible name (needs aria-label)',
                  !roled && 'no role (aria-label is DISCARDED on a generic element — needs role="region")',
                ].filter(Boolean).join('; '),
            );
          }
        }
      }

      expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
    });
  }
});
