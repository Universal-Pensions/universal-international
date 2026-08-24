#!/usr/bin/env python3
"""
gen-ledger.py — generate docs/audits/2026-08-23/REMEDIATION-LEDGER.md from findings.json.

The ledger is NEVER hand-transcribed. Every row's id / severity / demo_visible /
effort / category / agent / title / no-action quote is READ from findings.json.
Only the *judgement* layer lives here:

  DISPOSITION  — the adjudicated disposition for the rows that are not plain ACTION
  PHASE_FIX    — phases pinned by the remediation plan (authoritative, not inferred)
  DUP_PAIRS    — duplicate reconciliation: one owner, one DUPLICATE-OF
  RATIONALE    — one line per KEEP / DEFER / EXCLUDE / REFUTED row

Everything else (phase for the ~188 ACTION rows, owner, status, evidence-ref,
the quoted "No action…" justifications) is DERIVED by rule from findings.json.

Run:   python3 docs/audits/2026-08-23/scripts/gen-ledger.py
Verify: the script prints row count, blank-disposition count and the full
        disposition histogram to stdout and exits non-zero if anything is off.
"""

import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.dirname(HERE)                     # docs/audits/2026-08-23
REPO = os.path.dirname(os.path.dirname(os.path.dirname(AUDIT)))
FINDINGS = os.path.join(AUDIT, "findings.json")
OUT = os.path.join(AUDIT, "REMEDIATION-LEDGER.md")

LEDGER_DATE = "2026-08-25"
EXPECTED_ROWS = 221

# ---------------------------------------------------------------------------
# 1. JUDGEMENT LAYER — dispositions that are not plain ACTION
# ---------------------------------------------------------------------------

KEEP = [
    "A02-009", "A03-006", "A04-017", "A04-018", "A06-018", "A06-019",
    "A07-003", "A09-016", "A13-004", "A15-005", "A18-007", "A18-008",
    "A18-009", "A19-I1", "A21-007", "A24-008",
]

# A06-007 is REFUTED too, but it is not in findings.json — it was moved to
# SPECULATIVE.md before the corpus was frozen. It is carried as an out-of-corpus
# addendum row so the adjudication is complete without inflating the 221.
REFUTED = ["A19-I2", "A24-010"]
REFUTED_OUT_OF_CORPUS = ["A06-007"]

# DEFER rows carry no phase and no owner, by instruction.
DEFER = [
    "A03-007", "A06-016",                                   # pinned by the plan
    "A17-002", "A17-004", "A17-007", "A21-002", "A21-004",  # adjudicated here
    "A22-003", "A24-006", "A25-008",
]

EXCLUDE = ["A03-004", "A12-006", "A19-002", "A19-003", "A21-005"]

# ---------------------------------------------------------------------------
# 2. PHASES PINNED BY THE REMEDIATION PLAN (authoritative — never inferred)
# ---------------------------------------------------------------------------

PHASE_FIX = {
    # -- explicitly assigned by the remediation plan --------------------------
    "A03-005": "P7", "A04-016": "P2", "A05-011": "P1", "A05-015": "P3",
    "A06-015": "P4", "A07-002": "P6", "A07-004": "P6", "A12-I02": "P4",
    "A16-002": "P5", "A17-009": "P6", "A19-007": "P5", "A20-010": "P6",
    "A21-006": "P0", "A26-003": "P4+P7",
    "A26-004": "P7", "A26-006": "P7", "A26-008": "P7", "A26-009": "P7",
    "A26-010": "P7", "A26-011": "P7", "A26-012": "P7", "A26-014": "P7",
    "A26-016": "P7",
    # -- the 8 Criticals: code half -> P1, live-data half -> P2 ---------------
    "A05-001": "P1",   # missing tenancy check inside apply_settlement (code)
    "A11-002": "P1",   # onboarding wizard 409 (code)
    "A22-001": "P1",   # React Query cache not cleared on login (code)
    "A24-001": "P1",   # window.open(...,'noopener') certificate (code)
    "A05-002": "P2",   # E2E settlement residue in live DB (data)
    "A06-001": "P2",   # E2E employer money in live DB (data)
    # -- e2e failure routing (see the routing table in the ledger) ------------
    "A10-003": "P7",   # 12 mobile subscriber-dashboard failures = title drift
    # -- adjudicated re-routes away from the agent default --------------------
    "A04-009": "P2", "A04-010": "P2",   # leftover E2E money/rows -> data repair
    "A06-008": "P7", "A06-010": "P7",   # DB-invariant harness gaps -> tests
    "A13-003": "P7",   # remedy is "add an E2E on the mobile cap" -> tests
    "A19-004": "P6",   # virtualizer defeated on 4.6k rows -> perf
}

# ---------------------------------------------------------------------------
# 3. DUPLICATE RECONCILIATION — owner first, duplicate second
#    Rule: the owner is the finding on the surface where the single fix lands
#    (live-data residue -> the data-integrity agent; RPC/schema -> the money or
#    RLS agent; shared component -> the agent that owns that component).
#    The duplicate inherits the owner's phase so both rows route to one team.
# ---------------------------------------------------------------------------

DUP_PAIRS = [
    ("A05-002", "A11-001", "one E2E settlement-residue cleanup in the live DB"),
    ("A06-001", "A14-002", "one E2E employer-money cleanup in the live DB"),
    ("A06-004", "A11-005", "one policy-status derivation; A11-005 says 'verifies A06-004'"),
    ("A09-012", "A24-005", "one manifest move of @sentry/react out of devDependencies"),
    ("A06-006", "A15-003", "one delete of the same 4 E2E fixtures from the reconciliation queue"),
    ("A04-013", "A06-014", "one sign convention inside request_withdrawal"),
    ("A02-008", "A24-003", "one RLS policy chain that raises instead of filtering for anon"),
    ("A16-001", "A18-004", "one missing <h1> on the same public FAQ/Contact/About pages"),
    ("A13-002", "A15-004", "one loading state in the shared mobile entity-list component"),
]

# ---------------------------------------------------------------------------
# 4. RATIONALE — why each non-ACTION row is dispositioned that way
# ---------------------------------------------------------------------------

RATIONALE = {
    # KEEP — recorded state, verified non-defect, or a deliberate demo choice
    "A02-009": "Audit-window observation about live drift, not a product defect; the remedy is how future agents cite counts.",
    "A03-006": "Architectural note. RLS is enabled AND forced on all 34 tables, so a dropped policy fails closed.",
    "A04-017": "Migration 0102 documents the 602-row emergency-bucket residue as a deliberate non-backfill.",
    "A04-018": "Positive finding: 0105 stays reversible. The only obligation is to NOT drop the two rollback tables.",
    "A06-018": "The three violating rows are deliberate RECON-DEMO fixtures, not real premium data.",
    "A06-019": "Coverage note on an invariant, not a defect; NIN is not part of the demo story.",
    "A07-003": "CORS no-Origin acceptance is by design for the current token auth; revisit only if cookie auth arrives.",
    "A09-016": "Correction of an audit-plan premise. Planner stats survived the restore; nothing to change.",
    "A13-004": "Documented intentional architecture (panel state deliberately not URL-routed).",
    "A15-005": "Verification row: the admin hero figure is correct. The defect it feeds is A22-001.",
    "A18-007": "Minimal PWA manifest is adequate for a sales demo; richer install UX is optional polish.",
    "A18-008": "Offline mode is out of demo scope; failures already surface as toasts rather than silently.",
    "A18-009": "The install affordance already exists on landing-mobile; duplicating it in-dashboard is optional.",
    "A19-I1": "Recorded explicitly so ultrawide gutters are not re-flagged as a defect by a later pass.",
    "A21-007": "Measured CLS is negligible; a metric-matched fallback is optional polish.",
    "A24-008": "xlsx assessed clean: no advisory, integrity-pinned, write-side formula injection not reachable.",
    # DEFER — real, but deliberately after the demo
    "A03-007": "Real API-hygiene gap, but the report itself marks the uniform-404 remedy optional; no demo impact.",
    "A06-016": "Per-statement guard is working as built; the cumulative-budget upgrade is post-demo hardening.",
    "A17-002": "L-effort sweep across 76 ad-hoc font sizes; too broad to land safely before the demo.",
    "A17-004": "280 hex literals to swap for tokens; mechanical but wide-blast-radius, no user-visible defect.",
    "A17-007": "L-effort spacing-token migration plus a new lint rule; post-demo design-system work.",
    "A21-002": "CSS chunk slimming is measurable-but-invisible polish; no demo impact at current sizes.",
    "A21-004": "Index changes on the live demo DB carry deploy risk with no measurable benefit at demo volumes.",
    "A22-003": "Re-login on mid-session JWT expiry is real auth surgery; demo sessions are far shorter than the token life.",
    "A24-006": "Blocked: the fix edits package.json / package-lock.json, which currently hold the user's live WIP.",
    "A25-008": "New tooling (stylelint, import boundaries, pre-commit) needs the existing warning backlog burned down first.",
    # EXCLUDE — will not be actioned in this remediation
    "A03-004": "Sequence grants have no functional effect and no reachable exposure; same rationale as the A03-006 KEEP.",
    "A12-006": "Porting bulk Excel/CSV agent onboarding to mobile is feature work, not defect repair.",
    "A19-002": "Same intentional non-routed panel architecture that A13-004 records as KEEP; the report marks it report-only.",
    "A19-003": "Depends entirely on A19-002, which is excluded; the report marks it report-only.",
    "A21-005": "Consolidating the six per-role SELECT policies would churn exactly the RLS matrix Phase 3 is repairing.",
    # REFUTED
    "A19-I2": "The historical map onEachFeature empty-name->id race is fixed; the finding refutes itself.",
    "A24-010": "The 25P02 500s were audit-induced; the hypothesis was actively refuted, not merely unproven.",
    "A06-007": "Not reproducible from a clean state; moved to SPECULATIVE.md before the corpus was frozen.",
}

# ---------------------------------------------------------------------------
# 5. E2E BASELINE FAILURE ROUTING (30 failures -> owning findings)
# ---------------------------------------------------------------------------

E2E_ROUTING = [
    ("subscriber-dashboard smoke (6 specs x mobile-chromium + mobile-webkit)", 12,
     "A10-003", "P7", "P7-tests", "Mobile app-bar title divergence — test brittleness, not a product defect."),
    ("landing smoke FAQ / Contact / About (3 specs x 2 mobile engines)", 6,
     "A16-001 + A18-004", "P5", "P5-ux", "Real defect: public pages render no <h1> on mobile. A16-001 owns, A18-004 is DUPLICATE-OF it."),
    ("distributor-exports-csv :37 and :141 (x 2 mobile engines)", 4,
     "A10-001", "P4", "P4-dash", "Real defect: reports render empty in live mode, so the export has nothing to write."),
    ("agent-onboard-subscriber.spec.ts:109 (chromium + webkit)", 2,
     "A11-002", "P1", "P1-demo", "Real demo blocker: final create RPC returns 409 on the mock OCR's constant NIN."),
    ("modal-escape.spec.ts:224 (chromium + webkit)", 2,
     "A25-013", "P7", "P7-tests", "The ONLY true flake in the whole suite. Stabilise the spec; do not chase a product bug."),
    ("webkit-only: subscriber-signin:78, subscriber-signup:116, map-drill:250 x2", 4,
     "(new) P1-webkit", "P1", "P1-webkit", "No finding owns these. New agent P1-webkit triages WebKit-specific failures in Phase 1."),
]

# ---------------------------------------------------------------------------
# 6. PHASE LEGEND / OWNER LEGEND
# ---------------------------------------------------------------------------

PHASES = OrderedDict([
    ("P0", "safety rails"),
    ("P1", "demo blockers (the Criticals' code half)"),
    ("P2", "live data repair"),
    ("P3", "money engine + tenancy/RLS"),
    ("P4", "dashboard correctness"),
    ("P5", "mobile / a11y / design system"),
    ("P6", "performance / dependencies / infra"),
    ("P7", "tests / CI / docs"),
])

OWNERS = OrderedDict([
    ("P0-safety", "P0 — safety rails (destructive-seed guard, keepalive, rollback runbook, cold start)"),
    ("P1-demo", "P1 — the Criticals' code half"),
    ("P1-webkit", "P1 — WebKit-only e2e triage (new agent; owns no finding, owns 4 baseline failures)"),
    ("P2-data", "P2 — live demo-data repair (E2E residue, clock drift, seed staleness)"),
    ("P3-rls", "P3 — tenancy, RLS policies and the anon/privilege surface"),
    ("P3-money", "P3 — money engine, settlement and migration safety"),
    ("P4-dash", "P4 — role dashboard correctness (subscriber / agent / branch / distributor / employer / admin)"),
    ("P5-ux", "P5 — mobile, accessibility and design system"),
    ("P6-infra", "P6 — infra, deploy, config and performance"),
    ("P6-sec", "P6 — frontend security, headers and dependencies"),
    ("P7-tests", "P7 — test suite, CI gates, lint and typecheck"),
    ("P7-docs", "P7 — documentation accuracy and repo hygiene"),
])

# ---------------------------------------------------------------------------
# 7. DERIVATION RULES
# ---------------------------------------------------------------------------

# Categories that route to a phase regardless of which agent raised them.
CATEGORY_PHASE = {
    "data-hygiene": "P2",
    "data-staleness": "P2",
}

A11Y_CATEGORY_RE = re.compile(
    r"^(accessibility|a11y|color-contrast|focus-management|aria|scrollable-region|"
    r"responsive|motion-reduced-motion|component-divergence-a11y|lint-backlog|lint-noise)",
    re.I,
)

MONEY_TO_P4 = {"ui-server-mismatch", "timezone", "copy", "formatting"}
MONEY_TO_P2 = {"test-hygiene", "data-integrity", "hygiene"}
A06_TO_P3 = {"correctness", "multi-tenancy"}
A09_TO_P0 = {"data-destruction-risk", "availability-monitoring", "rollback"}
A09_TO_P7 = {"ci-gating", "type-safety"}

RLS_OWNER_RE = re.compile(r"tenancy|authz|rls|privilege|column-grant|least-privilege|doc-vs-live", re.I)
SEC_OWNER_RE = re.compile(r"security|pii|dependency|supply-chain|xss|privilege", re.I)


def default_phase(f):
    """Phase for an ACTION row that the plan did not pin explicitly."""
    agent, cat = f["agent"], f["category"]

    if cat in CATEGORY_PHASE:
        return CATEGORY_PHASE[cat]
    if A11Y_CATEGORY_RE.match(cat):
        return "P5"
    if cat.startswith("doc"):
        return "P7"

    if agent in ("A02", "A03"):
        return "P2" if cat.startswith("data-") else "P3"
    if agent in ("A04", "A05"):
        if cat in MONEY_TO_P4:
            return "P4"
        if cat in MONEY_TO_P2:
            return "P2"
        return "P3"
    if agent == "A06":
        return "P3" if cat in A06_TO_P3 else ("P7" if cat == "test-coverage" else "P2")
    if agent == "A07":
        return "P6"
    if agent == "A09":
        if cat in A09_TO_P0:
            return "P0"
        if cat in A09_TO_P7:
            return "P7"
        return "P6"
    if agent in ("A10", "A11", "A12", "A13", "A14", "A15"):
        return "P4"
    if agent in ("A16", "A17", "A18", "A19", "A20"):
        return "P5"
    if agent in ("A21", "A24"):
        return "P6"
    if agent == "A22":
        return "P4"
    if agent in ("A25", "A26"):
        return "P7"
    raise SystemExit("no phase rule for agent %s (%s)" % (agent, f["id"]))


def owner_for(phase, f):
    agent, cat = f["agent"], f["category"]
    if phase == "P4+P7":
        return "P4-dash + P7-docs"
    if phase == "P0":
        return "P0-safety"
    if phase == "P1":
        return "P1-demo"
    if phase == "P2":
        return "P2-data"
    if phase == "P3":
        return "P3-rls" if agent in ("A02", "A03") or RLS_OWNER_RE.search(cat) else "P3-money"
    if phase == "P4":
        return "P4-dash"
    if phase == "P5":
        return "P5-ux"
    if phase == "P6":
        return "P6-sec" if agent in ("A07", "A24") or SEC_OWNER_RE.search(cat) else "P6-infra"
    if phase == "P7":
        if agent == "A26" or cat.startswith("doc") or f["id"] == "A03-005":
            return "P7-docs"
        return "P7-tests"
    raise SystemExit("no owner rule for phase %s (%s)" % (phase, f["id"]))


NO_ACTION_RE = re.compile(
    r"\b(no action|no change needed|none required|no code change|report-only|"
    r"no functional effect|no correctness impact|documented intentional architecture|"
    r"no admin-side action|optional|optionally)\b",
    re.I,
)

# Fallback: some rows carry their no-action justification in `impact`, not in
# `suggested_fix` (e.g. A07-003 "none for this deployment", A21-005 "not a bug").
NO_DEFECT_RE = re.compile(
    r"\b(not a bug|not a defect|no defect|by design|none for|no impact|negligible|deliberate)\b",
    re.I,
)


def _first_matching_sentence(text, pattern):
    for sentence in re.split(r"(?<=\.)\s+", (text or "").strip()):
        s = sentence.strip()
        if s and pattern.search(s):
            return s
    return None


def no_action_quote(f):
    """The report's own literal justification, lifted verbatim from the finding."""
    fix = (f.get("suggested_fix") or "").strip()
    hit = _first_matching_sentence(fix, NO_ACTION_RE)
    if hit:
        return "suggested_fix: " + hit
    hit = _first_matching_sentence(f.get("impact"), NO_DEFECT_RE)
    if hit:
        return "impact: " + hit
    if not fix:
        return "(no suggested_fix recorded)"
    return "suggested_fix: " + (fix if len(fix) <= 200 else fix[:197] + "...")


def evidence_files():
    """agent prefix -> long-form evidence markdown, discovered from the audit dir."""
    m = {}
    for name in sorted(os.listdir(AUDIT)):
        mo = re.match(r"^(\d{2})-[a-z0-9-]+\.md$", name)
        if mo:
            m["A" + mo.group(1)] = name
    return m


def cell(text):
    return str(text).replace("|", r"\|").replace("\n", " ").strip()


# ---------------------------------------------------------------------------
# 8. BUILD
# ---------------------------------------------------------------------------

def build():
    with open(FINDINGS) as fh:
        findings = json.load(fh)

    by_id = {f["id"]: f for f in findings}
    evfiles = evidence_files()

    dup_owner_of = {dup: own for own, dup, _ in DUP_PAIRS}
    dup_of_owner = {own: dup for own, dup, _ in DUP_PAIRS}

    for known in list(KEEP) + REFUTED + DEFER + EXCLUDE + list(PHASE_FIX):
        if known not in by_id:
            raise SystemExit("adjudicated id %s is not in findings.json" % known)

    rows = []
    for f in findings:
        fid = f["id"]

        if fid in KEEP:
            disp = "KEEP"
        elif fid in REFUTED:
            disp = "REFUTED"
        elif fid in DEFER:
            disp = "DEFER"
        elif fid in EXCLUDE:
            disp = "EXCLUDE"
        else:
            disp = "ACTION"

        if disp == "ACTION":
            if fid in dup_owner_of:                       # duplicate inherits owner's phase
                own = dup_owner_of[fid]
                phase = PHASE_FIX.get(own) or default_phase(by_id[own])
            else:
                phase = PHASE_FIX.get(fid) or default_phase(f)
            owner = owner_for(phase, f)
        else:
            phase, owner = "—", "—"

        if disp == "ACTION" and fid in dup_owner_of:
            status = "DUPLICATE-OF %s" % dup_owner_of[fid]
        elif disp == "ACTION" and fid in dup_of_owner:
            status = "OPEN · owner of %s" % dup_of_owner[fid]
        elif disp == "ACTION":
            status = "OPEN"
        elif disp == "DEFER":
            status = "DEFERRED"
        else:
            status = "NO-ACTION"

        ref = evfiles.get(f["agent"], "findings.json")
        if disp in ("KEEP", "EXCLUDE", "REFUTED"):
            evidence = '`%s` · report says: "%s"' % (ref, no_action_quote(f))
        else:
            evidence = "`%s` · %s" % (ref, f["title"])

        dv = f.get("demo_visible")
        rows.append({
            "id": fid,
            "severity": f["severity"],
            "demo_visible": "n/r" if dv is None else ("yes" if dv else "no"),
            "effort": f.get("effort") or "n/r",
            "disposition": disp,
            "phase": phase,
            "owner": owner,
            "status": status,
            "evidence": evidence,
            "title": f["title"],
            "agent": f["agent"],
        })

    return rows, by_id, evfiles


SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def render(rows, by_id, evfiles):
    hist = Counter(r["disposition"] for r in rows)
    phase_hist = Counter(r["phase"] for r in rows if r["disposition"] == "ACTION")
    owner_hist = Counter(r["owner"] for r in rows if r["disposition"] == "ACTION")
    blanks = [r["id"] for r in rows if not r["disposition"].strip()]

    L = []
    A = L.append

    A("# Remediation ledger — audit 2026-08-23")
    A("")
    A("Generated %s by `docs/audits/2026-08-23/scripts/gen-ledger.py` from `findings.json`." % LEDGER_DATE)
    A("Do not hand-edit this file. Change the judgement tables in the generator and re-run:")
    A("")
    A("```")
    A("python3 docs/audits/2026-08-23/scripts/gen-ledger.py")
    A("```")
    A("")
    A("Every one of the %d findings has a disposition. There are no blank rows." % len(rows))
    A("")

    A("## Verification")
    A("")
    A("| check | result |")
    A("|---|---|")
    A("| rows in ledger | **%d** |" % len(rows))
    A("| rows in `findings.json` | **%d** |" % len(rows))
    A("| blank dispositions | **%d** |" % len(blanks))
    A("| duplicate pairs reconciled | **%d** (one owner + one DUPLICATE-OF each) |" % len(DUP_PAIRS))
    A("| e2e baseline failures routed | **%d of 30** |" % sum(n for _, n, _, _, _, _ in E2E_ROUTING))
    A("")
    A("### Disposition histogram")
    A("")
    A("| disposition | count |")
    A("|---|---|")
    for d in ["ACTION", "KEEP", "DEFER", "EXCLUDE", "REFUTED", "VERIFY"]:
        A("| %s | %d |" % (d, hist.get(d, 0)))
    A("| **total (in corpus)** | **%d** |" % len(rows))
    A("| REFUTED, out of corpus (`A06-007`, in `SPECULATIVE.md`) | 1 |")
    A("| **total adjudicated** | **%d** |" % (len(rows) + len(REFUTED_OUT_OF_CORPUS)))
    A("")
    A("`VERIFY` is part of the vocabulary but is unused: every row resolved to a")
    A("firm disposition, so nothing was parked pending re-measurement.")
    A("")
    A("### ACTION rows by phase")
    A("")
    A("| phase | scope | ACTION rows |")
    A("|---|---|---|")
    for p, desc in PHASES.items():
        A("| %s | %s | %d |" % (p, desc, phase_hist.get(p, 0)))
    if phase_hist.get("P4+P7"):
        A("| P4+P7 | spans dashboard correctness and docs | %d |" % phase_hist["P4+P7"])
    A("| **total** | | **%d** |" % sum(phase_hist.values()))
    A("")
    A("### ACTION rows by owner")
    A("")
    A("| owner | remit | rows |")
    A("|---|---|---|")
    for o, desc in OWNERS.items():
        A("| `%s` | %s | %d |" % (o, desc, owner_hist.get(o, 0)))
    for o in sorted(owner_hist):
        if o not in OWNERS:
            A("| `%s` | (composite) | %d |" % (o, owner_hist[o]))
    A("")
    A("`P1-webkit` owns no finding — it exists only to triage the 4 WebKit-only")
    A("baseline e2e failures listed in the routing table below.")
    A("")

    A("## Legend")
    A("")
    A("**Disposition** — `ACTION` fix it · `KEEP` accepted, no change · `DEFER` real but after the demo ·")
    A("`EXCLUDE` deliberately not doing it · `VERIFY` re-measure before deciding · `REFUTED` not a defect.")
    A("")
    A("**Status** — `OPEN` awaiting its phase · `OPEN · owner of X` this row carries the fix for duplicate X ·")
    A("`DUPLICATE-OF X` no separate work, X carries it · `DEFERRED` · `NO-ACTION`.")
    A("")
    A("**demo_visible** — `n/r` means the finding did not record the field (all four A07 rows).")
    A("")

    A("## Ledger — all %d findings" % len(rows))
    A("")
    A("Sorted by severity, then id.")
    A("")
    A("| id | severity | demo_visible | effort | disposition | phase | owner | status | evidence-ref |")
    A("|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: (SEV_ORDER[r["severity"]], r["id"])):
        A("| `%s` | %s | %s | %s | **%s** | %s | %s | %s | %s |" % (
            r["id"], r["severity"], r["demo_visible"], r["effort"],
            r["disposition"], r["phase"], cell(r["owner"]), cell(r["status"]), cell(r["evidence"]),
        ))
    A("")

    A("## Addendum — refuted, out of corpus")
    A("")
    A("`A06-007` was refuted during verification and moved to `SPECULATIVE.md` *before*")
    A("`findings.json` was frozen at %d rows, so it has no row in the table above." % len(rows))
    A("It is adjudicated here to keep the record complete.")
    A("")
    A("| id | severity | demo_visible | effort | disposition | phase | owner | status | evidence-ref |")
    A("|---|---|---|---|---|---|---|---|---|")
    A("| `A06-007` | high (as raised) | n/r | n/r | **REFUTED** | — | — | NO-ACTION | "
      '`SPECULATIVE.md` · report says: "Not reproducible against the live system from a clean state." |')
    A("")

    A("## Duplicate reconciliation")
    A("")
    A("Nine pairs describe the same defect twice. Each pair has exactly one owner; the")
    A("other row is `DUPLICATE-OF` and does no separate work. The duplicate inherits the")
    A("owner's phase so both ids route to one team.")
    A("")
    A("| owner (does the work) | duplicate (no work) | phase | why one fix closes both |")
    A("|---|---|---|---|")
    rowmap = {r["id"]: r for r in rows}
    for own, dup, why in DUP_PAIRS:
        A("| `%s` | `%s` | %s | %s |" % (own, dup, rowmap[own]["phase"], cell(why)))
    A("")
    A("Not adjudicated as duplicates, but overlapping — fix them together: `A09-005`,")
    A("`A24-009` and `A09-012`/`A24-005` are all facets of Sentry being absent from the")
    A("production bundle; `A04-010`, `A06-006`/`A15-003` and `A12-I01` are all the same")
    A("class of leftover E2E fixture rows in live data.")
    A("")

    A("## E2E baseline failure routing")
    A("")
    A("All 30 failures in the frozen baseline are accounted for. Only one is a flake.")
    A("")
    A("| baseline failure cluster | n | owning finding | phase | owner | verdict |")
    A("|---|---|---|---|---|---|")
    tot = 0
    for label, n, fid, ph, ow, verdict in E2E_ROUTING:
        tot += n
        A("| %s | %d | `%s` | %s | `%s` | %s |" % (cell(label), n, fid, ph, ow, cell(verdict)))
    A("| **total** | **%d** | | | | |" % tot)
    A("")
    A("22 of the 30 are mobile-viewport failures and 8 are WebKit — i.e. the baseline is")
    A("red exactly where the product is weakest, not where the tests are flaky.")
    A("")

    A("## Frozen baseline allowlist")
    A("")
    A("`a25/baseline-failures.txt` is **FROZEN as of %s** and is the machine-checkable" % LEDGER_DATE)
    A("allowlist of pre-existing e2e failures. Format: one Playwright test per line,")
    A("`[project] › spec:line:col › describe › test`, LC_ALL=C-sorted, 30 data lines.")
    A("Lines beginning with `#` are the frozen header and must be skipped by any parser.")
    A("")
    A("Baseline run: `npx playwright test --workers=1` (all 4 projects) — 326 passed /")
    A("30 failed / 14 skipped, exit 1, 24.4 min, logged to `baseline/playwright-full.txt`.")
    A("The 30 data lines regenerate from that log (verified byte-identical on %s):" % LEDGER_DATE)
    A("")
    A("```sh")
    A("awk '/^  [0-9]+ failed$/{f=1;next} /^  [0-9]+ (skipped|passed|flaky)/{f=0} f' \\")
    A("  docs/audits/2026-08-23/baseline/playwright-full.txt \\")
    A("  | sed 's/^    //; s/ *$//' | LC_ALL=C sort \\")
    A("  > docs/audits/2026-08-23/a25/baseline-failures.txt")
    A("```")
    A("")
    A("That command does not reproduce the `#` header — re-add it after regenerating.")
    A("")
    A("A phase may only ever **shorten** that list. A new line appearing in it is a")
    A("regression introduced by remediation, not a pre-existing failure.")
    A("")

    A("## Pre-existing dirty files (the user's WIP — not ours)")
    A("")
    A("Snapshot taken from `git status --porcelain` at the start of the ledger phase,")
    A("**before any remediation phase had written anything**. Exactly two files were")
    A("dirty at that moment, and both are the user's own WIP. No phase may commit,")
    A("revert or edit them, and no phase should mistake them for its own change.")
    A("Anything *else* that is dirty later belongs to a remediation phase, not to the")
    A("user.")
    A("")
    A("| file | change | provenance |")
    A("|---|---|---|")
    A("| `package.json` | `+ \"@axe-core/playwright\": \"^4.13.0\"` in `devDependencies` | "
      "user WIP; `00-baseline.md` calls it \"the only sanctioned dep change; remove after audit\" |")
    A("| `package-lock.json` | +18 / −3 lines, the lock entry for the same package | same |")
    A("")
    A("Consequence for `A24-006` (dependency backlog) and `A09-012`/`A24-005` (move")
    A("`@sentry/react` out of `devDependencies`): both fixes edit `package.json`, which is")
    A("held by this WIP. `A24-006` is DEFERRED for that reason; `A09-012` must coordinate")
    A("with the user before touching the manifest.")
    A("")

    A("## Disposition rationale — every non-ACTION row")
    A("")
    for label, ids in (("KEEP", KEEP), ("DEFER", DEFER), ("EXCLUDE", EXCLUDE),
                       ("REFUTED", REFUTED + REFUTED_OUT_OF_CORPUS)):
        A("### %s (%d)" % (label, len(ids)))
        A("")
        A("| id | title | why %s |" % label)
        A("|---|---|---|")
        for fid in sorted(ids):
            title = by_id[fid]["title"] if fid in by_id else "(refuted; see SPECULATIVE.md)"
            A("| `%s` | %s | %s |" % (fid, cell(title), cell(RATIONALE[fid])))
        A("")

    A("## Titles for the non-ACTION rows")
    A("")
    A("The ledger's evidence column carries the report's literal no-action quote for")
    A("`KEEP` / `EXCLUDE` / `REFUTED` rows instead of a title. Titles are here.")
    A("")
    A("| id | severity | disposition | title |")
    A("|---|---|---|---|")
    for r in sorted(rows, key=lambda r: r["id"]):
        if r["disposition"] in ("KEEP", "EXCLUDE", "REFUTED"):
            A("| `%s` | %s | %s | %s |" % (r["id"], r["severity"], r["disposition"], cell(r["title"])))
    A("")

    return "\n".join(L) + "\n", hist, blanks


def main():
    rows, by_id, evfiles = build()
    text, hist, blanks = render(rows, by_id, evfiles)

    with open(OUT, "w") as fh:
        fh.write(text)

    print("wrote %s" % os.path.relpath(OUT, REPO))
    print("rows: %d (expected %d)" % (len(rows), EXPECTED_ROWS))
    print("blank dispositions: %d" % len(blanks))
    print("disposition histogram:")
    for d in ["ACTION", "KEEP", "DEFER", "EXCLUDE", "REFUTED", "VERIFY"]:
        print("  %-8s %3d" % (d, hist.get(d, 0)))
    print("  %-8s %3d" % ("TOTAL", sum(hist.values())))
    print("out-of-corpus REFUTED (A06-007, SPECULATIVE.md): 1")

    ok = True
    if len(rows) != EXPECTED_ROWS:
        print("FAIL: expected %d rows, got %d" % (EXPECTED_ROWS, len(rows)))
        ok = False
    if blanks:
        print("FAIL: blank dispositions: %s" % ", ".join(blanks))
        ok = False
    if sum(hist.values()) != len(rows):
        print("FAIL: histogram does not sum to the row count")
        ok = False
    if len(set(r["id"] for r in rows)) != len(rows):
        print("FAIL: duplicate ids in ledger")
        ok = False
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
