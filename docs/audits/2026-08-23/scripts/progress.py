#!/usr/bin/env python3
"""Cross-reference the 221 findings against what git actually says was done.

Deliberately derives 'closed' from COMMIT MESSAGES rather than from any agent's
self-report: an agent claiming a finding closed is a claim; a commit touching the
tree is evidence. Run from the repo root.
"""
import json, re, subprocess, collections, sys

FINDINGS = 'docs/audits/2026-08-23/findings.json'
LEDGER   = 'docs/audits/2026-08-23/REMEDIATION-LEDGER.md'

findings = json.load(open(FINDINGS))
by_id = {f['id']: f for f in findings}

# Dispositions from the ledger (the adjudicated source of truth).
disp = {}
for line in open(LEDGER):
    m = re.match(r'\|\s*`(A\d\d-[A-Z0-9]+)`\s*\|[^|]*\|[^|]*\|[^|]*\|\s*\*?\*?(\w+)', line)
    if m:
        disp[m.group(1)] = m.group(2)

# Every finding id named anywhere in a commit message on this branch.
log = subprocess.run(
    ['git', 'log', 'main..HEAD', '--pretty=%H%x00%s%x00%b%x01'],
    capture_output=True, text=True).stdout
mentioned = collections.defaultdict(list)
for entry in log.split('\x01'):
    if not entry.strip(): continue
    parts = entry.strip().split('\x00')
    if len(parts) < 2: continue
    sha, subject = parts[0][:7], parts[1]
    body = parts[2] if len(parts) > 2 else ''
    for fid in set(re.findall(r'A\d\d-[A-Z0-9]+', subject + ' ' + body)):
        mentioned[fid].append((sha, subject))

action = {i for i, d in disp.items() if d == 'ACTION'}
noaction = {i for i, d in disp.items() if d in ('KEEP', 'DEFER', 'EXCLUDE', 'REFUTED')}
done = action & set(mentioned)
todo = action - set(mentioned)

print(f"findings.json          {len(findings)}")
print(f"adjudicated in ledger  {len(disp)}")
print(f"  ACTION               {len(action)}")
print(f"  no-action            {len(noaction)}  (KEEP/DEFER/EXCLUDE/REFUTED)")
print()
print(f"ACTION addressed in a commit   {len(done)}")
print(f"ACTION still open              {len(todo)}")
print()
byphase = collections.Counter()
for fid in todo:
    m = re.search(r'\|\s*`' + fid + r'`\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(P\d[^|]*)\|', open(LEDGER).read())
    byphase[(m.group(1).strip() if m else '?')] += 1
print("still open, by phase:")
for k, v in sorted(byphase.items()):
    print(f"  {k:<8} {v}")
if '--list' in sys.argv:
    print("\nstill open:")
    for fid in sorted(todo):
        f = by_id.get(fid, {})
        print(f"  {fid}  {f.get('severity','?'):<8} {f.get('title','')[:88]}")
