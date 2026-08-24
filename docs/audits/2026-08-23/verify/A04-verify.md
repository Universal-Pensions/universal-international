# A04 — Adversarial verification (money engine / NAV pricing)

Verifier ran every critical/high finding against the LIVE DB from a clean state, wrapped
in BEGIN…ROLLBACK, re-reading after ROLLBACK to prove nothing persisted. Spot-checked 5 of
the 8 mediums. No writes committed. Secrets redacted per G2.

s-0004 pre-state (real, unchanged after every probe):
`671179 | ret 536943 | emg 134236 | units 427.1217067764500730 | ru 341.697365 | invested 609894.31`

## Highs — all CONFIRMED

### A04-001 — make_contribution accepts NaN/Infinity — CONFIRMED (high)
- Live body line 19 is the only amount guard: `IF p_amount IS NULL OR p_amount <= 0`.
- `select 'NaN'::numeric <= 0` → **f** (Postgres sorts NaN above every numeric), so the guard cannot fire.
- Called the REAL RPC as a subscriber JWT inside a txn: `make_contribution('A04V-nan-1','NaN'::numeric,80,'MTN')`
  returned a settled tx; `subscriber_balances` for s-0004 went `NaN|NaN|NaN|NaN|NaN`.
- ROLLBACK re-read == pre-state; 0 leftover nonces.
- Reachability lens: make_contribution is EXECUTE-granted to `authenticated`; the in-body role check
  only demands app_role='subscriber', which a subscriber JWT carries. Shipped UI can't emit NaN
  (JSON.stringify(NaN)=null), but a crafted PostgREST `{"p_amount":"NaN"}` string casts to numeric and
  passes. NOT already-guarded. NOT demo-scope (input-validation data-corruption, not payment rails).
  Irrecoverable-from-app (publish derives total from units*price → NaN propagates) → high stands, and is
  correctly distinguished from the recoverable medium A04-005.

### A04-002 — request_withdrawal negative leg creates money — CONFIRMED (high)
- Body lines 65-69 validate only `(v_split_ret+v_split_emg) <> p_amount`; no per-leg sign/bucket check.
- Trigger line 31 `retirement_balance = GREATEST(0, retirement_balance - v_ret_take)`; v_ret_take=-100000 ADDS.
- Real RPC `request_withdrawal('A04V-neg-leg',100000,NULL,'verify','MTN',-100000,200000)`:
  retirement **536943 → 636943 (+100000, money created)**, total 671179→571179, invariant_break 65764.
- ROLLBACK re-read == pre-state; 0 leftover nonce. high stands (data invariant violated / write corrupts data).

### A04-003 — reseed + next NAV publish inflates AUM 57% and zeroes retirement — CONFIRMED (high)
- Seed facts verified in source: `UNIT_PRICE=1000` + `unitsFromBalance` (units=total/1000);
  `nav_snapshots` never truncated/inserted by the seed (grep: NO MATCH); the subscriber_balances insert
  writes only 5 cols, and `retirement_units|emergency_units|invested` all default to 0.
- publish_nav_snapshot lines 72-79: `retirement_balance = round(retirement_units*price)`,
  `emergency = round(units*price) - round(retirement_units*price)`.
- Reproduced end-to-end through the REAL publish RPC: set s-0004 to the seed shape
  (units=671.18, retirement_units=0, invested=0), published NAV 1571.4 →
  **total 671179→1054692 (+57.1%), retirement 536943→0, emergency 134236→1054692**.
- ROLLBACK re-read == real pre-state. high (latent until a reseed; author's "critical the moment anyone
  reseeds" is right — it requires the reseed to manifest, so high not critical is correct).

## Mediums spot-checked — all CONFIRMED
- **A04-004** bucket=emergency overdraw: withdraw 400000 from emg(134236) → emg clamped 0, total debited full
  (271179), retirement untouched 536943, invariant_break 265764. Rolled back. CONFIRMED.
- **A04-005** publish NaN: unit_price=0/-5 correctly rejected; `NaN` with confirm=true accepted, aum=NaN,
  all 5060 rows NaN. Rolled back (latest nav still 1571.4, 0 NaN rows). Recoverable → medium correct. CONFIRMED.
- **A04-006** down-migration clobber: 0 LIVE functions hardcode `v_unit_price:=1000` (forward path clean);
  each of 0042/0043/0072/0089 `.down.sql` has exactly 1 `CREATE OR REPLACE trg_transactions_contribution`
  with `v_unit_price NUMERIC := 1000` used for `NEW.amount / v_unit_price`. CONFIRMED (parse-only, G6 respected).
- **A04-009** leftover EMP- runs: `33 runs | 1881 rows | 145,372,000 UGX`; contribution 1254/120,292,000,
  insurance_premium 627/25,080,000. Matches finding exactly. CONFIRMED.
- **A04-010** TST subscribers: 4 `missing_balance` exceptions (TST employer/retag/tree×2); subscribers 5064 vs
  balances 5060 = the 4-row gap. CONFIRMED. (Minor: title names only 'tree'/'retag'; evidence lists all 4.)

## Verdict summary
8/8 checked findings CONFIRMED. No refutations, no demo-scope exclusions, no severity adjustments.
The three highs are genuinely reachable via authenticated PostgREST RPC (grants verified) or via the
documented reseed path; none are already-guarded. No fixture rows created; every probe rolled back and
re-read clean.
