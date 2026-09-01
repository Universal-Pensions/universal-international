// The gate in front of a database wipe.
//
// `npm run seed` TRUNCATEs 26 tables and cascades into 6 more that the script
// never names — money_nonces (money-RPC replay protection) and nominee_claims
// among them. This repo has already suffered one accidental live reseed
// (2026-06-16). Until now the guard had NO tests, because it lived inside
// seed-supabase.mjs, which executes on import: testing it would have run the
// seed. Extracting it into scripts/seed-guard.mjs is what makes these possible.
//
// The assertion that matters most is the last group. The original guard stopped
// accidents-by-omission and then printed a copy-pasteable production wipe to
// someone it had just told they were doing something dangerous.

import { describe, it, expect } from 'vitest';
import {
  parseProjectRef,
  isProductionRef,
  evaluateDestroyRequest,
  PRODUCTION_REFS,
  YES_FLAG,
  PRODUCTION_FLAG,
} from '../../scripts/seed-guard.mjs';

const PROD = 'ilkhfnoyxlxwqadebnkp';
const CI = 'zengmiugieqjqzaccbqe';
const poolerUrl = (ref) => `postgresql://postgres.${ref}:s3cr3t@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const directUrl = (ref) => `postgresql://postgres:s3cr3t@db.${ref}.supabase.co:5432/postgres`;

describe('parseProjectRef', () => {
  it('reads the ref out of the pooler form, where it hides in the username', () => {
    expect(parseProjectRef(poolerUrl(PROD))).toBe(PROD);
  });

  it('reads the ref out of the direct form, where it is the host label', () => {
    expect(parseProjectRef(directUrl(CI))).toBe(CI);
  });

  it('survives a password containing @ — the reason this is regex, not new URL()', () => {
    const url = `postgresql://postgres.${PROD}:p@ss:w0rd@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
    // `new URL()` splits userinfo on the LAST @, which would read the ref out of
    // the wrong half and could hand a production wipe a non-production name.
    expect(parseProjectRef(url)).toBe(PROD);
  });

  it('returns null rather than guessing on anything unrecognised', () => {
    for (const bad of ['', null, undefined, 'not-a-url', 'postgresql://localhost:5432/postgres']) {
      expect(parseProjectRef(bad)).toBeNull();
    }
  });
});

describe('evaluateDestroyRequest — refusals', () => {
  it('refuses a bare run with no confirmation flag', () => {
    const v = evaluateDestroyRequest(poolerUrl(CI), []);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('no-confirmation');
  });

  it('refuses when the named ref does not match the URL', () => {
    const v = evaluateDestroyRequest(poolerUrl(CI), [YES_FLAG, PROD]);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('ref-mismatch');
  });

  it('refuses an unparseable URL rather than proceeding against an unknown target', () => {
    const v = evaluateDestroyRequest('postgresql://localhost/postgres', [YES_FLAG, PROD]);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('unparseable-url');
  });
});

describe('evaluateDestroyRequest — non-production', () => {
  it('proceeds when the caller names a matching non-production ref', () => {
    const v = evaluateDestroyRequest(poolerUrl(CI), [YES_FLAG, CI]);
    expect(v).toMatchObject({ ok: true, projectRef: CI, production: false });
  });

  it('does not demand the production flag for a non-production target', () => {
    // Flag fatigue is a real failure mode: if every run needs the scary flag,
    // people alias it away and it stops meaning anything.
    expect(evaluateDestroyRequest(directUrl(CI), [YES_FLAG, CI]).ok).toBe(true);
  });
});

describe('evaluateDestroyRequest — production needs a second, deliberate flag', () => {
  it('knows which refs are production', () => {
    expect(isProductionRef(PROD)).toBe(true);
    expect(isProductionRef(CI)).toBe(false);
    expect(PRODUCTION_REFS).toContain(PROD);
  });

  it('refuses production when only the ref is named — the accident-by-compliance case', () => {
    const v = evaluateDestroyRequest(poolerUrl(PROD), [YES_FLAG, PROD]);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('production-not-acknowledged');
  });

  it('proceeds on production only with BOTH flags', () => {
    const v = evaluateDestroyRequest(poolerUrl(PROD), [YES_FLAG, PROD, PRODUCTION_FLAG]);
    expect(v).toMatchObject({ ok: true, projectRef: PROD, production: true });
  });

  it('NEVER prints a ready-to-paste production wipe', () => {
    // The whole point. The old guard's refusal ended with
    //   npm run seed -- --yes-destroy ilkhfnoyxlxwqadebnkp
    // handed to someone who had just been warned. Refusing and then supplying
    // the command is not a refusal.
    for (const argv of [[], [YES_FLAG, PROD]]) {
      const v = evaluateDestroyRequest(poolerUrl(PROD), argv);
      expect(v.ok).toBe(false);
      expect(v.message).not.toMatch(new RegExp(`${YES_FLAG}\\s+${PROD}`));
    }
  });

  it('still offers the helpful command for a NON-production target', () => {
    // The convenience was worth keeping where it is not dangerous.
    const v = evaluateDestroyRequest(poolerUrl(CI), []);
    expect(v.message).toMatch(new RegExp(`${YES_FLAG}\\s+${CI}`));
  });

  it('names production in the refusal so the reader knows why they were stopped', () => {
    const v = evaluateDestroyRequest(poolerUrl(PROD), [YES_FLAG, PROD]);
    expect(v.message).toMatch(/PRODUCTION/);
    expect(v.message).toMatch(new RegExp(PRODUCTION_FLAG));
  });
});
