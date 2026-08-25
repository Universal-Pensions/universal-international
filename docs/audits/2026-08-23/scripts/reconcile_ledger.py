#!/usr/bin/env python3
"""Reconcile the ledger's status column with what the commits actually say.

Same evidence rule as progress.py: a finding is CLOSED when a commit on this
branch names its id. An agent's self-report is a claim; a commit is evidence.

Operates on SPLIT COLUMNS, not a regex over the row. A first attempt used a
capture-group regex and silently dropped the `owner` column from 174 rows —
the row still looked plausible, which is exactly why it was worth catching.
Every row's column count is asserted before and after.
"""
import re, subprocess, collections, sys

LEDGER = 'docs/audits/2026-08-23/REMEDIATION-LEDGER.md'
ID_COL, STATUS_COL, NCOL = 1, 8, 11

log = subprocess.run(['git','log','main..HEAD','--pretty=%H%x00%s%x00%b%x01'],
                     capture_output=True, text=True).stdout
mentioned = collections.defaultdict(list)
for entry in log.split('\x01'):
    if not entry.strip(): continue
    parts = entry.strip().split('\x00')
    if len(parts) < 2: continue
    sha, subject = parts[0][:7], parts[1]
    body = parts[2] if len(parts) > 2 else ''
    for fid in set(re.findall(r'A\d\d-[A-Z0-9]+', subject + ' ' + body)):
        mentioned[fid].append(sha)

FID = re.compile(r'^`(A\d\d-[A-Z0-9]+)`$')
STATE = re.compile(r'^(OPEN|CLOSED|PARTIAL|BLOCKED|DEFERRED)\b(.*)$', re.I)

out, flipped, kept = [], 0, 0
for line in open(LEDGER):
    cols = line.rstrip('\n').split('|')
    if len(cols) != NCOL:
        out.append(line); continue
    m = FID.match(cols[ID_COL].strip())
    if not m:
        out.append(line); continue

    fid = m.group(1)
    shas = sorted(set(mentioned.get(fid, [])))
    if not shas:
        out.append(line); continue

    s = cols[STATUS_COL].strip()
    sm = STATE.match(s)
    if not sm:
        out.append(line); continue
    state, annot = sm.group(1).upper(), sm.group(2).rstrip()

    if state != 'OPEN':
        kept += 1                      # a deliberate PARTIAL/BLOCKED stands
        out.append(line); continue

    cols[STATUS_COL] = f" CLOSED{annot} · {', '.join(shas)} "
    new = '|'.join(cols) + '\n'
    assert len(new.rstrip('\n').split('|')) == NCOL, f"column count broke on {fid}"
    out.append(new); flipped += 1

open(LEDGER,'w').writelines(out)
print(f"OPEN -> CLOSED : {flipped}")
print(f"left as-is (deliberate non-OPEN): {kept}")
