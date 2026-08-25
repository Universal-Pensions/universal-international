/**
 * CSP violation-report normalisation (A24-002 / A09-004).
 *
 * Browsers send violation reports in two mutually incompatible shapes, and a
 * sink that understands only one silently discards half its traffic:
 *
 *   report-uri  (older, still the most widely sent)
 *     Content-Type: application/csp-report
 *     { "csp-report": { "effective-directive": ..., "blocked-uri": ..., ... } }
 *
 *   Reporting API / report-to (newer)
 *     Content-Type: application/reports+json
 *     [ { "type": "csp-violation", "body": { "effectiveDirective": ..., "blockedURL": ... } } ]
 *
 * Note the key casing differs too — kebab-case in the old shape, camelCase in the
 * new one — so even after unwrapping the envelope the fields do not line up.
 *
 * Extracted from the route handler purely so this is testable; the Express route
 * itself cannot be unit-tested without booting the app.
 */

export interface NormalisedCspReport {
  directive: string | null;
  blocked: string | null;
  document: string | null;
  disposition: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Turn either wire shape into a flat list. Never throws: a violation report is
 * telemetry from an untrusted page and must not be able to break the sink.
 */
export function normaliseCspReports(raw: unknown): NormalisedCspReport[] {
  let envelopes: unknown[];

  if (Array.isArray(raw)) {
    // Reporting API: [{ type, body }, ...]. Fall back to the item itself if a
    // sender omits `body`.
    envelopes = raw.map((r) => (r as Record<string, unknown>)?.body ?? r);
  } else if (raw && typeof raw === 'object') {
    const wrapped = (raw as Record<string, unknown>)['csp-report'];
    envelopes = [wrapped ?? raw];
  } else {
    return [];
  }

  const out: NormalisedCspReport[] = [];
  for (const e of envelopes) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const rep: NormalisedCspReport = {
      // kebab-case first (report-uri), then camelCase (Reporting API), then the
      // deprecated `violated-directive` some older engines still send.
      directive: str(r['effective-directive']) ?? str(r.effectiveDirective) ?? str(r['violated-directive']),
      blocked: str(r['blocked-uri']) ?? str(r.blockedURL),
      document: str(r['document-uri']) ?? str(r.documentURL),
      disposition: str(r.disposition),
    };
    // Drop entries that carry no usable signal at all rather than logging noise.
    if (rep.directive || rep.blocked || rep.document) out.push(rep);
  }
  return out;
}
