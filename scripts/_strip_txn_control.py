#!/usr/bin/env python3
"""Strip a migration's OWN transaction control, and nothing else.

The previous implementation was `grep -vE '^(BEGIN|COMMIT|ROLLBACK|END)\\s*;'`,
a regex with no idea what a dollar-quoted string is. In PL/pgSQL, `END;` at
column 0 is overwhelmingly the *body terminator* of a function, not transaction
control — this repo has 369 of them across 116 migrations, and the regex deleted
every one, leaving the body unterminated and guaranteeing a syntax error on
probe. (Worked around once by indenting a migration, which was fixing the file
to suit the tool rather than the tool.)

This tracks dollar-quote state, so a line is only stripped when it is genuinely
at statement level.
"""
import re, sys

TXN = re.compile(r'^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\s*(WORK|TRANSACTION)?\s*;', re.I)
TAG = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$')

def strip(text):
    out, stripped, tag = [], [], None
    for i, line in enumerate(text.split('\n'), 1):
        if tag is None and TXN.match(line):
            stripped.append((i, line.strip()))
            continue                      # statement-level txn control: drop it
        out.append(line)
        # update dollar-quote state AFTER the decision, scanning this line
        for m in TAG.finditer(line):
            t = m.group(0)
            if tag is None: tag = t
            elif tag == t:  tag = None
    return '\n'.join(out), stripped, tag

if __name__ == '__main__':
    src = open(sys.argv[1]).read()
    body, stripped, unbalanced = strip(src)
    if unbalanced is not None:
        print(f"psql-probe: {sys.argv[1]} ends inside an unterminated {unbalanced} "
              f"dollar-quote — refusing to strip a file I cannot parse.", file=sys.stderr)
        sys.exit(5)
    sys.stdout.write(body)
    for ln, txt in stripped:
        print(f"psql-probe: stripped {sys.argv[1]}:{ln}  {txt}", file=sys.stderr)
