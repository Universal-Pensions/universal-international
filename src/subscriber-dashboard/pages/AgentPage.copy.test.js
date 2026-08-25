// A22-006 — the support-ticket confirmation must not promise delivery.
//
// The demo ticket store (src/services/tickets.js) is sessionStorage-backed, so
// it is PER TAB — exactly like the module-level Map it replaced. A ticket is
// genuinely recorded and genuinely routed, but it is not transmitted anywhere
// the named recipient can read from their own session.
//
// The original copy said "Your issue has been sent to your agent." The reported
// repro was that the ticket then vanished on refresh (Open 3→2, no error). The
// persistence half of that is fixed. The copy half is separate and survives it:
// even with persistence, "sent" is a claim the demo cannot honour across tabs.
//
// Source-scanning rather than rendering: AgentPage needs react-query, a router,
// toast context and the supabase mock to mount, and the thing under test is a
// string literal. Same convention as src/test/claude-md-*-contract.test.js.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PAGE = resolve(__dirname, 'AgentPage.jsx');

// Only the argument of an addToast(...) call — comments explaining the history
// are allowed to quote the old wording.
function toastStrings(src) {
  return [...src.matchAll(/addToast\(\s*'[^']*'\s*,\s*(["'])((?:\\.|(?!\1).)*)\1/g)]
    .map((m) => m[2]);
}

describe('A22-006 — ticket confirmation copy is honest', () => {
  const src = readFileSync(AGENT_PAGE, 'utf8');
  const toasts = toastStrings(src);

  it('finds the create-ticket confirmations', () => {
    expect(toasts.length).toBeGreaterThanOrEqual(2);
  });

  it('never claims the issue was sent or delivered', () => {
    const offenders = toasts.filter((t) => /\b(sent|delivered|notified)\b/i.test(t));
    expect(offenders, `overclaiming toast copy: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it('says the issue was logged and who will pick it up', () => {
    const created = toasts.filter((t) => /issue has been/i.test(t));
    expect(created.length).toBe(2);
    for (const t of created) {
      expect(t, `"${t}"`).toMatch(/logged/i);
      expect(t, `"${t}"`).toMatch(/pick it up/i);
    }
  });
});
