# NEW FINDING · A03-101 — any signed-in member could make themselves an admin

**CRITICAL. Not in the 221.** Found 2026-08-25 while triaging the Supabase advisor's
`SECURITY DEFINER` warnings — the kind of finding a wall of 79 uniform WARNs is very good at
hiding. **Fixed and applied the same day (migration `0128`).**

## The hole

`public.register_login_identity(text,text,text,text,text,text)` is `SECURITY DEFINER`, has **no
role guard of any kind**, and `EXECUTE` was granted to `authenticated`. Any signed-in user —
including a subscriber, the lowest-privileged role — could call it through
`/rest/v1/rpc/register_login_identity` and mint a login identity for **any role against any
entity**.

## Proven live, inside a rolled-back transaction

A JWT carrying `app_role=subscriber`, `subscriberId=s-0001`:

```sql
SELECT public.register_login_identity(
         '+256711999888', 'admin', 'admin-001', 'Escalation Probe', 'Escalation Probe', NULL);
--  -> '+256711999888'
```

and it wrote **both** identity rows:

```
public.users          id='admin:+256711999888'   role='admin'   entity_id='admin-001'
public.demo_personas  phone='+256711999888'      role='admin'   entity_id='admin-001'
```

The attacker chooses the phone, so they control it. And per `CLAUDE.md §8` the demo OTP route
**accepts any 6-digit code**. So the next step is simply to sign in on that phone and be an admin,
with platform-wide visibility across every distributor, employer and member.

**This is wider than A02-001.** That one lets a subscriber inflate their own balance. This one
hands over the whole platform.

## Why the existing check did not stop it

The function's only guard is:

```sql
IF EXISTS (SELECT 1 FROM public.demo_personas
            WHERE phone = v_phone AND role = p_role
              AND entity_id IS DISTINCT FROM p_entity_id) THEN RETURN NULL;
```

That prevents **hijacking an existing** phone+role binding. It does nothing whatsoever to stop
**minting a new one**, which is the attack. Reading the guard quickly, it looks like protection.

## The fix — `0128`, applied

`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`.

**Deliberately not a body guard.** The function's three legitimate callers —
`approve_access_request`, `create_distributor`, `create_employer` — all need it to run where the
*caller* may not be an admin (a public access-request approval; tenant creation). A body guard
would have to encode all three exceptions: more surface, not less.

All three are `SECURITY DEFINER`, verified live, so they reach it as the **owner** rather than
through the caller's privileges. Revoking breaks none of them. No application code calls it
directly either — the only references are in `src/test/login-identity-contract.test.js`, which
reads migration *files* rather than calling the RPC.

`FROM PUBLIC` matters and was a second bug in my own first draft: Postgres's default for a
function is `EXECUTE` to `PUBLIC`. Live had an explicit grant and no `PUBLIC` entry, so the named
revoke alone would have sufficed *today* — but a future `CREATE OR REPLACE` that drops the ACL
would silently restore the `PUBLIC` default and re-open this. The migration's own guard caught
the incomplete version and aborted.

## Verified after applying

| check | result |
|---|---|
| `authenticated` can call it | **false** |
| `anon` can call it | **false** |
| escalation retried as a subscriber | **blocked — permission denied** |
| a normal contribution still works | **yes** — `tx-s-0002-adhoc-…`, balance 224,314 |
| probe rows left in live | **0** |

## Also revoked: eight trigger functions

The advisor flagged these as `anon`/`authenticated`-executable `SECURITY DEFINER` functions. They
cannot actually be invoked through PostgREST — Postgres refuses to call a `RETURNS trigger`
function directly — so this is hygiene rather than a hole. It is worth doing anyway: eight
standing warnings were helping to camouflage the real one above.

**Verified empirically before doing it, not assumed:**

```
has_function_privilege('probe_user','_t_probe_fn()','EXECUTE')  -> f
INSERT as probe_user                                            -> trigger fired, touched = t
```

Postgres performs no `EXECUTE` check at trigger-fire time. Contributions were re-tested against
live after applying, and still work.

## The lesson

The advisor reported 79 `SECURITY DEFINER` warnings at a uniform WARN level. 78 are correct by
design — the app's RPCs and RLS helpers genuinely must be callable. One was a critical privilege
escalation. Triaging them as a category, or dismissing them as noise because most are expected,
would have missed it. The question that found it was not "is this function exposed" but **"does
this function check who is calling it"** — which is answerable in bulk:

```sql
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
   AND pg_get_functiondef(p.oid) !~* 'app_role|v_role|auth\.jwt|request\.jwt';
```

Of 68 `authenticated`-executable DEFINER functions, that narrows to a handful, and every one of
those is either a trigger function, a claims-only RLS helper, or public reference data — except
this one.
