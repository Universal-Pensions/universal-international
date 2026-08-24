# METRICS — full audit roll-up

## Findings by severity

| Severity | Count |
|---|---|
| critical | 8 |
| high | 25 |
| medium | 76 |
| low | 68 |
| info | 44 |
| **Total** | **221** |
| Refuted (speculative) | 1 |

## By agent

| Agent | C | H | M | L | I | Total |
|---|---|---|---|---|---|---|
| A02 | 0 | 2 | 3 | 3 | 2 | 10 |
| A03 | 0 | 1 | 0 | 2 | 4 | 7 |
| A04 | 0 | 3 | 8 | 4 | 3 | 18 |
| A05 | 2 | 3 | 4 | 4 | 2 | 15 |
| A06 | 1 | 4 | 5 | 6 | 3 | 19 |
| A07 | 0 | 0 | 1 | 2 | 1 | 4 |
| A09 | 0 | 3 | 6 | 5 | 4 | 18 |
| A10 | 0 | 1 | 1 | 1 | 1 | 4 |
| A11 | 2 | 1 | 3 | 1 | 1 | 8 |
| A12 | 0 | 0 | 4 | 4 | 2 | 10 |
| A13 | 0 | 1 | 0 | 2 | 1 | 4 |
| A14 | 1 | 1 | 1 | 1 | 0 | 4 |
| A15 | 0 | 1 | 2 | 1 | 1 | 5 |
| A16 | 0 | 0 | 1 | 1 | 1 | 3 |
| A17 | 0 | 0 | 3 | 5 | 1 | 9 |
| A18 | 0 | 0 | 3 | 3 | 3 | 9 |
| A19 | 0 | 0 | 5 | 2 | 2 | 9 |
| A20 | 0 | 0 | 5 | 5 | 1 | 11 |
| A21 | 0 | 0 | 1 | 3 | 3 | 7 |
| A22 | 1 | 0 | 4 | 1 | 1 | 7 |
| A24 | 1 | 0 | 1 | 5 | 4 | 11 |
| A25 | 0 | 1 | 9 | 2 | 1 | 13 |
| A26 | 0 | 3 | 6 | 5 | 2 | 16 |

## Verification

| Metric | Value |
|---|---|
| C/H findings adversarially verified | 38 (30 phase1/2/5 + 8 phase3/4) |
| CONFIRMED | 70 |
| SEVERITY-ADJUST | 4 |
| REFUTED | 1 |

## Coverage
| Item | Value |
|---|---|
| Domain agents | 26 (A00–A26) |
| Role walkthroughs | 7/7 |
| Screenshots | 333 |
| Live-DB writes, all reconciled to baseline | users→48; 285 employer-run txns retained as A06 evidence; 1 s-0001 contribution documented |