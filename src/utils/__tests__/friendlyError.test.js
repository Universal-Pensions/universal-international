// A22-004: err.message is always populated (services/api.js's createApiError
// and the direct-Supabase path both guarantee a non-empty message), so the
// house pattern `addToast('error', err?.message || fallback)` never falls
// through to the friendly fallback. getFriendlyErrorMessage is the fix — these
// tests pin its behaviour against the EXACT error shapes seen in the audit
// evidence (docs/audits/2026-08-23/22-state-errors.md CHECK 5) and against the
// real postgrest-js network-failure shape (verified against
// node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts: a fetch()
// failure returns `error: { message: '${name}: ${message}', code: '', ... }`
// — a PLAIN OBJECT, not an Error instance).

import { describe, it, expect } from 'vitest';
import { getFriendlyErrorMessage } from '../friendlyError';

const FALLBACK = 'Could not complete the top-up.';

describe('getFriendlyErrorMessage', () => {
  it('replaces the raw postgrest-js network-failure string with plain copy', () => {
    // The exact shape postgrest-js returns on a dropped connection: a plain
    // object (NOT instanceof Error) whose message is "TypeError: Failed to fetch".
    const err = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' };
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('replaces api.js\'s network_unreachable code the same way, even with different message text', () => {
    const err = new Error('Could not reach server');
    err.code = 'network_unreachable';
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('replaces api.js\'s timeout code', () => {
    const err = new Error('Request timed out');
    err.code = 'timeout';
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('recognises Safari\'s and Firefox\'s network-failure wording too', () => {
    expect(getFriendlyErrorMessage({ message: 'Load failed' }, FALLBACK)).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
    expect(
      getFriendlyErrorMessage({ message: 'NetworkError when attempting to fetch resource.' }, FALLBACK),
    ).toBe('Could not reach the server. Check your connection and try again.');
  });

  it('falls back on an opaque Postgres exception wrapper ("unexpected error while executing …")', () => {
    const err = { message: 'unexpected error while executing make_contribution', code: 'XX000' };
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on a bare "<JsError>: …" prefix', () => {
    expect(getFriendlyErrorMessage({ message: 'RangeError: invalid array length' }, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on api.js\'s server_unavailable / backend_down codes', () => {
    const e1 = new Error('Server unavailable');
    e1.code = 'server_unavailable';
    expect(getFriendlyErrorMessage(e1, FALLBACK)).toBe(FALLBACK);

    const e2 = new Error('API server not running — run `npm run dev:all`.');
    e2.code = 'backend_down';
    expect(getFriendlyErrorMessage(e2, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on raw Postgres constraint/permission internals', () => {
    expect(getFriendlyErrorMessage({ message: 'duplicate key value violates unique constraint "transactions_pkey"' }, FALLBACK)).toBe(FALLBACK);
    expect(getFriendlyErrorMessage({ message: 'permission denied for table subscribers' }, FALLBACK)).toBe(FALLBACK);
    expect(getFriendlyErrorMessage({ message: 'null value in column "amount" violates not-null constraint' }, FALLBACK)).toBe(FALLBACK);
  });

  it('maps an auth-expiry-shaped error (PGRST301) to a session-expired message, not the fallback', () => {
    const err = { message: 'JWT expired', code: 'PGRST301' };
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe('Your session has expired. Please sign in again.');
  });

  it('maps a bare 401 status the same way', () => {
    const err = { message: 'Unauthorized', status: 401 };
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe('Your session has expired. Please sign in again.');
  });

  it('PRESERVES a short, human-authored RPC validation message as-is (this is the real, useful case)', () => {
    const err = { message: 'amount must be greater than zero', code: 'P0001' };
    expect(getFriendlyErrorMessage(err, FALLBACK)).toBe('amount must be greater than zero');
  });

  it('falls back when there is no message at all', () => {
    expect(getFriendlyErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(getFriendlyErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(getFriendlyErrorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(getFriendlyErrorMessage({ message: '   ' }, FALLBACK)).toBe(FALLBACK);
  });

  it('never returns a raw JS error-name string verbatim', () => {
    const result = getFriendlyErrorMessage({ message: 'TypeError: Failed to fetch' }, FALLBACK);
    expect(result).not.toMatch(/^[A-Z][A-Za-z]*Error/);
  });
});
