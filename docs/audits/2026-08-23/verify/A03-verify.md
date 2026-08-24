# A03 — Adversarial Verification

Verifier stance: refute by default. All writes wrapped in `BEGIN…ROLLBACK` and re-read after ROLLBACK. Nothing persisted. Secrets redacted (G2). No fixture rows left behind.

## Summary
| Finding | Sev (author) | Verdict | Sev (should be) |
|---|---|---|---|
| A03-001 cross-tenant re-tag + comp overwrite via anon invite RPC | high | **CONFIRMED** (upgrade confidence plausible→confirmed) | high |
| A03-002 client-trusted phone canonicalization → login-unreachable row | low | CONFIRMED | low |
| A03-003 no length cap on subscriber text fields | low | CONFIRMED | low |
| A03-004 seqs retain anon rwU | info | CONFIRMED | info |
| A03-006 34 anon-SELECT tables are RLS-only | info | CONFIRMED | info |

## A03-001 — CONFIRMED (high). The author's write repro was classifier-blocked; I reproduced it in a rolled-back txn.

**anon EXECUTE + DEFINER as postgres (RLS-bypassing):**
```
has_function_privilege('anon',oid,'EXECUTE') = t   args: (payload jsonb, p_token text, p_nonce text)
prosecdef = t   owner = postgres   search_path = public, pg_temp
```
Live prosrc: line 10 loads the invite by `p_token` only; lines 15-18 key entirely on the caller-supplied `payload->>'phone'`; the re-tag branch (22-24) runs `UPDATE subscribers SET employer_id=v_inv.employer_id WHERE id=v_existing_id`; lines 77-79 overwrite `compensation` from `v_inv.prefill->>'compensation'`. The invite's own intended phone is never compared:
```
(prosrc ~* 'prefill[^;]*phone')::int | regexp_count(prosrc,'prefill')  ->  0 | 1
```
(prefill referenced once, at line 78 — compensation only.)

**Rolled-back end-to-end reproduction** (victim s-100117, employer_id NULL, comp 0; invite prefill phone `701234567`, comp `1000000`; caller supplies a DIFFERENT phone `+256701231323`):
```
BEGIN;
 BEFORE|s-100117||0
 -- (temporarily flip one invite to pending + now()+7d, in-txn)
 RPC_RETURN|s-100117                 <- existing-subscriber re-tag branch fired
 AFTER|s-100117|emp-001|1000000      <- re-homed onto emp-001 AND compensation overwritten
ROLLBACK;
 POST_ROLLBACK|s-100117||0           <- nothing persisted
```
Post-rollback re-read: all 4 invites still `pending`/expired, no `completed`, no `subscriber_id`; victim unchanged. Blast radius `count(*) FILTER (WHERE employer_id IS NULL) WHERE phone<>'' = 5006`.

- (a) Reproduce: YES (above).
- (b) Demo-scope: NO. The OUT-OF-SCOPE list does not cover invite phone-binding; the DO-report list explicitly names "leaks one tenant's data to another" and "shows WRONG MONEY" — this does both (cross-employer re-home + compensation overwrite).
- (c) Guarded: partially. Precondition = holder of a valid *pending, non-expired* invite token (122-bit random, unguessable). All 4 live invites are expired right now, so not exploitable this instant; any employer minting a fresh invite (routine) opens a 7-day window. This is a real latent authz gap, not unreachable. Severity high stands (write corrupts data across tenants + wrong money). Confidence upgraded to confirmed.

## A03-002 — CONFIRMED (low)
`_validate_signup_payload:32` regex `^(\+?256)?[0-9]{9}$` accepts a bare 9-digit; `_insert_subscriber_chain:78` stores `p_payload ->> 'phone'` verbatim. Login canonicalizes: `verify-password.ts:94` / `verify-otp.ts:171` `toCanonicalUGPhone(phone)||phone` → `resolveSubscriber(...,canonicalPhone)` → `personas.ts:76 .eq('phone', phone)`; miss → `ROLE_DEFAULTS.subscriber='s-0001'`. A row stored bare `799900001` never equals `+256799900001`. Correctly scoped low + NOT demo-reachable (ContributionRoute canonicalizes before the RPC).

## A03-003 — CONFIRMED (low)
`information_schema.columns`: subscribers name/email/phone/nin/occupation are all `text` with `character_maximum_length = NULL`; insert chain writes verbatim. No cap.

## A03-004 — CONFIRMED (info)
`has_sequence_privilege('anon','subscriber_id_seq','USAGE'|'UPDATE') = t|t`; same for `commission_id_seq`; `entity_detach_log_id_seq` USAGE = f (revoked by 0080). No reachable path (PostgREST never exposes nextval/setval). Least-privilege note only.

## A03-006 — CONFIRMED (info)
34 anon-SELECT tables, all `relrowsecurity|relforcerowsecurity = t|t`. Dropping a policy fails default-deny (availability), not leak. Architectural note.

## Write discipline
Only mutation executed was inside a single `BEGIN…ROLLBACK`; post-rollback re-reads confirm zero persistence on `subscribers` and `employer_invites`. No rows created or left behind.
