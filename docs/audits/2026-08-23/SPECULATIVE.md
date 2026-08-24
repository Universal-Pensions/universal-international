# SPECULATIVE — findings that failed verification or lack reproducible evidence

Per guardrail G9: no evidence (or refuted) → here, not in FINDINGS.md.

## A06-007 · Live stored XSS payloads sit at the top of two admin queues (was high)
- **Why not a finding:** Not reproducible against the live system from a clean state. The A24XSSPROBE rows have been deleted since A06 captured evidence: a full text-column XSS pattern scan now returns 0 hits, the two access_requests and two nominee_claims IDs A06 named no longer exist, and pending access_requests is now 4 (finding claimed 6). The finding was valid when captured (transient probe litter left by A24), and the actual stored-XSS vulnerability is A24's render-side finding — A06's data-presence claim no longer holds.
- **Verifier evidence:** access_requests/nominee_claims WHERE ilike '%A24XSS%' -> 0 rows. IDs ar-1787558699527-rmm4, ar-1787558701196-dksm, nc-bbf6090b..., nc-d810114b... -> 0 rows. DO-block scan (<script|onerror|onload|javascript:|<iframe|<svg) over all text cols -> TOTAL flagged column-hits: 0. pending/total access_requests -> 4|5.
- **Original evidence:** I scanned EVERY text/varchar column of EVERY base table for <script, onerror=, onload=, javascript:, <img..src=, <svg, <iframe, {{, ${, SQL metacharacters and trailing --:
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' <<'SQL'
DO $$ DECLARE r record; n bigint; total bigint := 0; BEGIN
  FOR r IN SELECT c
