// Tests for CSP violation-report normalisation (A24-002 / A09-004).
//
// The point of the finding is that the CSP was inert in BOTH directions —
// blocking nothing AND reporting nowhere. A sink that only understands one of
// the two wire formats is still, in practice, reporting nowhere for half of
// real traffic. These tests exist to stop that regressing.

import { describe, it, expect } from 'vitest';
import { normaliseCspReports } from './cspReport';

describe('normaliseCspReports — both browser wire formats', () => {
  it('reads the report-uri shape (kebab-case, wrapped in "csp-report")', () => {
    const body = {
      'csp-report': {
        'document-uri': 'https://uganda-dashboard.vercel.app/',
        'effective-directive': 'font-src',
        'blocked-uri': 'https://fonts.gstatic.com/s/inter/v20/x.woff2',
        disposition: 'report',
        'script-sample': 'SHOULD NOT BE LOGGED',
      },
    };
    expect(normaliseCspReports(body)).toEqual([{
      directive: 'font-src',
      blocked: 'https://fonts.gstatic.com/s/inter/v20/x.woff2',
      document: 'https://uganda-dashboard.vercel.app/',
      disposition: 'report',
    }]);
  });

  it('reads the Reporting API shape (camelCase, an array of {type, body})', () => {
    const body = [{
      type: 'csp-violation',
      url: 'https://uganda-dashboard.vercel.app/employers',
      body: {
        documentURL: 'https://uganda-dashboard.vercel.app/employers',
        effectiveDirective: 'script-src',
        blockedURL: 'inline',
        disposition: 'enforce',
      },
    }];
    expect(normaliseCspReports(body)).toEqual([{
      directive: 'script-src',
      blocked: 'inline',
      document: 'https://uganda-dashboard.vercel.app/employers',
      disposition: 'enforce',
    }]);
  });

  it('never returns script-sample — it can carry page content, and this service handles member data', () => {
    const out = normaliseCspReports({
      'csp-report': {
        'effective-directive': 'script-src',
        'script-sample': 'const nin = "CF92018AB3CD45"',
        'blocked-uri': 'inline',
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/script-sample|CF92018AB3CD45/);
  });

  it('falls back to the deprecated violated-directive some engines still send', () => {
    const out = normaliseCspReports({
      'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://evil.example/x.png' },
    });
    expect(out[0].directive).toBe('img-src');
  });

  it('handles a Reporting API entry that omits `body`', () => {
    const out = normaliseCspReports([{ effectiveDirective: 'font-src', blockedURL: 'x' }]);
    expect(out[0].directive).toBe('font-src');
  });

  it('returns [] rather than throwing on junk — a report must never break the sink', () => {
    for (const junk of [null, undefined, 'a string', 42, [], {}, [null], [{}], { 'csp-report': null }]) {
      expect(() => normaliseCspReports(junk)).not.toThrow();
      expect(Array.isArray(normaliseCspReports(junk))).toBe(true);
    }
  });

  it('drops entries carrying no usable signal instead of logging noise', () => {
    expect(normaliseCspReports([{ body: { disposition: 'report' } }])).toEqual([]);
  });
});
