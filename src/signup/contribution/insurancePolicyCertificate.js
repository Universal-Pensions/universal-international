/**
 * Insurance policy certificate — generates a styled, printable HTML document
 * and opens it in a new tab. Users print → save as PDF via their browser.
 *
 * No external dependencies for the OUTPUT tab. All CSS is inlined because the
 * new tab has no access to the Vite bundle's stylesheets / fonts. Uses system
 * font stacks with the project's brand fonts at the front (`Plus Jakarta Sans`,
 * `Inter`). Money/date strings are produced with the app's central formatters
 * (en-UG), so the certificate reads consistently with the rest of the UI.
 */

import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';

const INDIGO = '#292867';
const INDIGO_SOFT = '#5E63A8';
const INK = '#1B1A4A';
const SUBTLE = '#5F6783';

const FREQ_CADENCE = {
  weekly: 'every week',
  monthly: 'every month',
  quarterly: 'every 3 months',
  'half-yearly': 'every 6 months',
  annually: 'every year',
};

const RELATIONSHIP_LABEL = {
  spouse: 'Spouse',
  child: 'Child',
  parent: 'Parent',
  sibling: 'Sibling',
  other: 'Other',
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderBeneficiaryRows(beneficiaries) {
  if (!beneficiaries || beneficiaries.length === 0) {
    return `<tr><td colspan="3" class="empty">No beneficiaries named.</td></tr>`;
  }
  return beneficiaries
    .map((b) => {
      const name = escapeHtml(b?.name || '—');
      const rel = escapeHtml(RELATIONSHIP_LABEL[b?.relationship] || b?.relationship || '—');
      const share = Number.isFinite(Number(b?.share)) ? `${Number(b.share)}%` : '—';
      return `<tr><td>${name}</td><td>${rel}</td><td class="share">${share}</td></tr>`;
    })
    .join('');
}

export function buildPolicyCertificateHtml(data) {
  const {
    holderName,
    memberId,
    dob,
    cover,
    premiumPerPeriod,
    frequency,
    policyStart,
    renewalDate,
    beneficiaries = [],
    // Product label drives the certificate title ("Life" | "Health" | …).
    // Defaults to Life so existing callers (signup) are unchanged.
    productLabel = 'Life',
    // Health insurance has no payout beneficiaries — callers can hide the
    // beneficiaries section for those products.
    showBeneficiaries = true,
  } = data || {};

  const product = escapeHtml(productLabel || 'Life');

  const holder = escapeHtml(holderName || 'Policy Holder');
  const member = escapeHtml(memberId || '—');
  const dobStr = formatDate(dob);
  const startStr = formatDate(policyStart);
  const renewalStr = formatDate(renewalDate);
  const todayStr = formatDate(new Date());
  const coverStr = formatUGX(cover, { compact: false });
  const premiumStr = formatUGX(premiumPerPeriod, { compact: false });
  const cadence = FREQ_CADENCE[frequency] || frequency || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Universal Pensions — Certificate of ${product} Insurance</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    @page { size: A4; margin: 18mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #F5F5F7;
      color: ${INK};
      font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    body {
      padding: 32px 16px 56px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .toolbar {
      width: 100%;
      max-width: 794px;
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }
    .print-btn {
      appearance: none;
      border: none;
      background: ${INDIGO};
      color: #fff;
      font-family: inherit;
      font-weight: 700;
      letter-spacing: -0.01em;
      font-size: 14px;
      padding: 10px 18px;
      border-radius: 999px;
      cursor: pointer;
      box-shadow: 0 8px 18px -8px rgba(41, 40, 103, 0.45);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .print-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 24px -10px rgba(41, 40, 103, 0.55);
    }
    .certificate {
      width: 100%;
      max-width: 794px; /* A4 width at 96dpi */
      background: #fff;
      padding: 56px 64px 48px;
      border-radius: 6px;
      box-shadow: 0 30px 60px -30px rgba(27, 26, 74, 0.25);
      position: relative;
      overflow: hidden;
    }
    .certificate::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 6px;
      background: linear-gradient(90deg, ${INDIGO} 0%, ${INDIGO_SOFT} 60%, ${INDIGO} 100%);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 36px;
      border-bottom: 1px solid #E6E7EF;
      padding-bottom: 24px;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .brand-mark {
      font-family: inherit;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: ${INDIGO};
    }
    .brand-sub {
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: ${SUBTLE};
      font-weight: 600;
    }
    .badge {
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(46, 139, 87, 0.12);
      color: #1F6B43;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border: 1px solid rgba(46, 139, 87, 0.25);
    }
    .title-block {
      margin-bottom: 32px;
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: ${INDIGO_SOFT};
      font-weight: 700;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: ${INDIGO};
      margin: 0;
      line-height: 1.1;
    }
    section {
      margin-bottom: 28px;
    }
    h2 {
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: ${SUBTLE};
      font-weight: 700;
      margin: 0 0 12px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px 28px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field-label {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${SUBTLE};
      font-weight: 700;
    }
    .field-value {
      font-size: 15px;
      font-weight: 700;
      color: ${INK};
      letter-spacing: -0.01em;
      word-break: break-word;
    }
    .field-value.mono {
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.05em;
    }
    .hero {
      background: linear-gradient(135deg, ${INK} 0%, ${INDIGO} 60%, ${INDIGO_SOFT} 100%);
      color: #fff;
      border-radius: 10px;
      padding: 22px 26px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
    }
    .hero-field-label {
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.72);
      font-weight: 700;
      margin-bottom: 6px;
    }
    .hero-field-value {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
    }
    .hero-cadence {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.78);
      margin-left: 4px;
      letter-spacing: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    thead th {
      text-align: left;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: ${SUBTLE};
      font-weight: 700;
      padding: 10px 12px;
      border-bottom: 1px solid #E6E7EF;
    }
    tbody td {
      padding: 12px;
      border-bottom: 1px solid #F0F1F6;
      color: ${INK};
      font-weight: 600;
    }
    tbody tr:last-child td { border-bottom: none; }
    td.share { font-variant-numeric: tabular-nums; text-align: right; }
    td.empty { color: ${SUBTLE}; font-style: italic; font-weight: 500; }
    footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid #E6E7EF;
      font-size: 11px;
      color: ${SUBTLE};
      line-height: 1.6;
    }
    footer p { margin: 0 0 4px 0; }
    footer strong { color: ${INK}; font-weight: 700; }
    @media print {
      html, body { background: #fff; }
      body { padding: 0; }
      .toolbar { display: none; }
      .certificate {
        box-shadow: none;
        border-radius: 0;
        padding: 0;
        max-width: none;
      }
      .certificate::before { display: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" class="print-btn" onclick="window.print()">Print or save as PDF</button>
  </div>

  <article class="certificate">
    <header class="header">
      <div class="brand">
        <span class="brand-mark">Universal Pensions Uganda</span>
        <span class="brand-sub">Pinbox · URBRA-licensed</span>
      </div>
      <span class="badge">Active</span>
    </header>

    <div class="title-block">
      <div class="eyebrow">Certificate</div>
      <h1>Certificate of ${product} Insurance</h1>
    </div>

    <section>
      <h2>Policy holder</h2>
      <div class="grid">
        <div class="field">
          <span class="field-label">Full name</span>
          <span class="field-value">${holder}</span>
        </div>
        <div class="field">
          <span class="field-label">Member ID</span>
          <span class="field-value mono">${member}</span>
        </div>
        <div class="field">
          <span class="field-label">Date of birth</span>
          <span class="field-value">${dobStr}</span>
        </div>
      </div>
    </section>

    <section class="hero">
      <div>
        <div class="hero-field-label">Total cover</div>
        <div class="hero-field-value">${coverStr}</div>
      </div>
      <div>
        <div class="hero-field-label">Premium</div>
        <div class="hero-field-value">${premiumStr}<span class="hero-cadence"> ${escapeHtml(cadence)}</span></div>
      </div>
    </section>

    <section>
      <h2>Effective period</h2>
      <div class="grid">
        <div class="field">
          <span class="field-label">Policy start</span>
          <span class="field-value">${startStr}</span>
        </div>
        <div class="field">
          <span class="field-label">Renewal date</span>
          <span class="field-value">${renewalStr}</span>
        </div>
        <div class="field">
          <span class="field-label">Status</span>
          <span class="field-value">Active</span>
        </div>
      </div>
    </section>

    ${showBeneficiaries ? `<section>
      <h2>Beneficiaries</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Relationship</th>
            <th class="share">Share</th>
          </tr>
        </thead>
        <tbody>
          ${renderBeneficiaryRows(beneficiaries)}
        </tbody>
      </table>
    </section>` : ''}

    <footer>
      <p><strong>Issued ${todayStr}</strong> · Protected under Uganda's Insurance Act, 2017.</p>
      <p>This certificate is computer-generated and does not require a signature.</p>
      <p>Universal Pensions Uganda · privacy@universalpensions.com</p>
    </footer>
  </article>
</body>
</html>`;
}

export function openPolicyCertificate(data) {
  const html = buildPolicyCertificateHtml(data);
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  try {
    win.document.title = `UPU Policy Certificate — ${data?.holderName || ''}`.trim();
  } catch {
    // Cross-origin or permission edge — non-fatal.
  }
  return true;
}
