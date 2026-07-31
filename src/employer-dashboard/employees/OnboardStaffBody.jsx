// OnboardStaffBody — the single/bulk/review/result onboarding flow, extracted
// from OnboardStaffPanel so BOTH surfaces mount the same body:
//   • OnboardStaffPanel  → wraps it in the desktop/legacy EmployerSlidePanel.
//   • OnboardStaffMobile → mounts it directly inside the routed mobile shell.
// Dismissal is a prop (onClose) so each caller controls how it leaves (close the
// panel vs navigate away). All data + validation logic is unchanged.
//
//   • Single: enter one member's identity → the server mints a tokenized invite
//     link the employer shares; the member completes KYC, which creates a real
//     subscriber tagged to this employer.
//   • Bulk: download an Excel template, fill one row per member, upload it,
//     review the parsed rows, and create invites for every valid row at once.

import { useRef, useState } from 'react';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployer, useCreateInvite, useBulkCreateInvites } from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { downloadSheet, parseSheet } from '../../utils/xlsx';
import { parseUGPhoneLocal } from '../../utils/phone';
import { contributionFundingLabel, memberFundingSummary } from '../../utils/contributionModel';
import styles from './OnboardStaffPanel.module.css';

const PHONE_RE = /^(\+?256)?[0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY = { fullName: '', phone: '', email: '', compensation: '' };

const TEMPLATE_COLUMNS = [
  { key: 'fullName', label: 'Full name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'compensation', label: 'Monthly compensation (UGX)' },
];
const TEMPLATE_EXAMPLES = [
  { fullName: 'Jane Akello', phone: '+256700000001', email: 'jane.akello@example.com', compensation: 800000 },
  { fullName: 'John Okello', phone: '+256700000002', email: 'john.okello@example.com', compensation: 650000 },
];

const DownloadIcon = (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
    <path d="M10 3v9M10 12l-3-3M10 12l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 14v2h14v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const UploadIcon = (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
    <path d="M10 16V7M10 7L7 10M10 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 5V4h14v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Case-insensitive header lookup — tolerates "Full name" / "name" / "Email…". */
function pick(row, ...names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((key) => key.trim().toLowerCase() === n);
    if (k != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

function rowError(fullName, phone, email, compensation) {
  if (fullName.length < 2) return 'Name missing';
  if (!PHONE_RE.test(phone)) return 'Invalid phone';
  if (!EMAIL_RE.test(email)) return 'Invalid email';
  const comp = Number(compensation);
  if (compensation === '' || !Number.isFinite(comp) || comp < 0) return 'Invalid compensation';
  return '';
}

function toPrefill({ fullName, phone, email, compensation }) {
  return {
    fullName: fullName.trim(),
    phone: parseUGPhoneLocal(phone.trim()) || phone.trim(),
    email: email.trim(),
    compensation: Number(compensation) || 0,
  };
}

export default function OnboardStaffBody({ onClose }) {
  const { employerId } = useEmployerScope();
  const { data: employer } = useEmployer(employerId);
  const { addToast } = useToast();
  const createInvite = useCreateInvite(employerId);
  const bulkCreate = useBulkCreateInvites(employerId);
  const fileInputRef = useRef(null);

  const [mode, setMode] = useState('single'); // 'single' | 'bulk'
  const [err, setErr] = useState('');

  // Single
  const [form, setForm] = useState(EMPTY);
  const [result, setResult] = useState(null); // { link, name }
  const [copied, setCopied] = useState(false);

  // Bulk
  const [parsed, setParsed] = useState(null); // { fileName, rows: [{ fullName, phone, email, valid, error }] }
  const [bulkResult, setBulkResult] = useState(null); // { created, failed, total }

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (err) setErr('');
  };

  function reset() {
    setMode('single');
    setForm(EMPTY);
    setErr('');
    setResult(null);
    setCopied(false);
    setParsed(null);
    setBulkResult(null);
  }
  function switchMode(next) {
    setMode(next);
    setErr('');
  }

  // ── Single ────────────────────────────────────────────────────────────────
  function validate() {
    if (form.fullName.trim().length < 2) return 'Enter the member’s full name.';
    if (!PHONE_RE.test(form.phone.trim())) return 'Enter a valid Uganda phone (9 digits, optional +256).';
    if (!EMAIL_RE.test(form.email.trim())) return 'Enter the member’s email — the invite link goes there.';
    const comp = Number(form.compensation);
    if (form.compensation === '' || !Number.isFinite(comp) || comp < 0) return 'Enter the member’s monthly compensation (UGX, 0 or more).';
    return '';
  }

  async function submit() {
    if (createInvite.isPending) return;
    const e = validate();
    if (e) { setErr(e); return; }
    try {
      // `collectSchedule` also comes back from the invite RPC but is deliberately
      // ignored: the member never sets their own amounts under the company
      // two-leg setup (the server forces their schedule amount to 0), so the
      // success copy below states the two figures instead.
      const { token } = await createInvite.mutateAsync(toPrefill(form));
      const link = `${window.location.origin}/invite/${token}`;
      setResult({ link, name: form.fullName.trim() });
    } catch (e2) {
      setErr(e2?.message || 'Could not create the invite.');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      addToast('success', 'Invite link copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Could not copy — select the link and copy manually.');
    }
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────
  async function downloadTemplate() {
    const typed = form.fullName.trim() || form.phone.trim() || form.email.trim();
    const seedRows = typed
      ? [{ fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim(), compensation: form.compensation.trim() }]
      : TEMPLATE_EXAMPLES;
    try {
      await downloadSheet({
        rows: seedRows,
        columns: TEMPLATE_COLUMNS,
        filename: 'employee-onboarding-template',
        sheetName: 'Employees',
      });
      addToast('success', 'Template downloaded — fill one row per member, then upload it.');
    } catch (e2) {
      addToast('error', e2?.message || 'Could not download the template.');
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after an error
    if (!file) return;
    setErr('');
    const { rows, errors } = await parseSheet(file);
    if (errors.length > 0) {
      setErr(errors[0] || 'Could not read the file — use the downloaded template.');
      return;
    }
    const mapped = rows.map((r) => {
      const fullName = pick(r, 'full name', 'name', 'fullname');
      const phone = pick(r, 'phone', 'phone number', 'mobile');
      const email = pick(r, 'email', 'email address', 'e-mail');
      const compensation = pick(r, 'monthly compensation (ugx)', 'monthly compensation', 'compensation', 'salary');
      const error = rowError(fullName, phone, email, compensation);
      return { fullName, phone, email, compensation, valid: !error, error };
    });
    if (mapped.length === 0) {
      setErr('That file had no rows. Use the template’s columns: Full name, Phone, Email, Monthly compensation (UGX).');
      return;
    }
    setParsed({ fileName: file.name, rows: mapped });
  }

  async function onboardBulk() {
    if (bulkCreate.isPending || !parsed) return;
    const valid = parsed.rows.filter((r) => r.valid).map(toPrefill);
    if (valid.length === 0) { setErr('No valid rows to onboard. Fix the flagged rows and re-upload.'); return; }
    try {
      const res = await bulkCreate.mutateAsync(valid);
      setBulkResult(res);
      addToast('success', `${res.created} member${res.created === 1 ? '' : 's'} invited.`);
    } catch (e2) {
      setErr(e2?.message || 'Could not onboard the uploaded members.');
    }
  }

  const validCount = parsed ? parsed.rows.filter((r) => r.valid).length : 0;
  const invalidCount = parsed ? parsed.rows.length - validCount : 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  if (result) {
    // What the MEMBER will see once they are active. They do not choose any
    // amounts — the company funding setup drives both legs — so this states the
    // two concrete figures in their words. null means 0/0: nothing is funded yet.
    const memberSummary = memberFundingSummary(employer?.defaultContributionConfig, employer?.name);
    return (
      <div className={styles.body}>
        <p className={styles.note}>
          <strong>{result.name}</strong> has been invited and shows as <strong>pending</strong> in
          your roster. Share this link — they’ll complete identity verification (KYC), and their
          account activates tagged to your company.
        </p>
        <p className={styles.note}>
          {memberSummary
            ? <>They don’t pick any amounts. Their pension page will show: <strong>{memberSummary}</strong>.</>
            : <>Nothing is being funded yet — set what your staff put in and what you add on the Settings page, and it applies to them too.</>}
        </p>
        <div className={styles.linkBox}>
          <span className={styles.linkText}>{result.link}</span>
          <button type="button" className={styles.copyBtn} onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p className={styles.note}>No email is sent in this demo — copy the link and share it with the member.</p>
        {err && <p className={styles.err} role="alert">{err}</p>}
        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={reset}>Invite another</button>
          <button type="button" className={styles.primary} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  if (bulkResult) {
    return (
      <div className={styles.body}>
        <p className={styles.note}>
          <strong>{bulkResult.created}</strong> member{bulkResult.created === 1 ? '' : 's'} invited — they show as
          <strong> pending</strong> in your roster until they complete KYC.
          {bulkResult.failed > 0 ? ` ${bulkResult.failed} row${bulkResult.failed === 1 ? '' : 's'} could not be created.` : ''}
        </p>
        <p className={styles.note}>No emails are sent in this demo. Pending members appear in the roster.</p>
        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={reset}>Onboard more</button>
          <button type="button" className={styles.primary} onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  if (parsed) {
    return (
      <div className={styles.body}>
        <p className={styles.note}>
          Reviewing <strong>{parsed.fileName}</strong> — {validCount} ready
          {invalidCount > 0 ? `, ${invalidCount} need attention (only valid rows are onboarded)` : ''}.
        </p>
        <div className={styles.reviewWrap}>
          <table className={styles.reviewTable}>
            <thead>
              <tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Compensation (UGX)</th><th>Status</th></tr>
            </thead>
            <tbody>
              {parsed.rows.map((r, i) => (
                <tr key={i} data-invalid={!r.valid || undefined}>
                  <td className={styles.reviewNum}>{i + 1}</td>
                  <td>{r.fullName || '—'}</td>
                  <td>{r.phone || '—'}</td>
                  <td className={styles.reviewEmail}>{r.email || '—'}</td>
                  <td>{r.compensation || '—'}</td>
                  <td>
                    {r.valid
                      ? <span className={styles.ok}>Ready</span>
                      : <span className={styles.bad}>{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <p className={styles.err} role="alert">{err}</p>}
        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={() => { setParsed(null); setErr(''); }} disabled={bulkCreate.isPending}>
            Choose another file
          </button>
          <button type="button" className={styles.primary} onClick={onboardBulk} disabled={validCount === 0 || bulkCreate.isPending} aria-busy={bulkCreate.isPending || undefined}>
            {bulkCreate.isPending ? 'Onboarding…' : `Onboard ${validCount} member${validCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    );
  }

  // Entry — Single / Bulk toggle.
  return (
    <div className={styles.body}>
      <div className={styles.modeToggle} role="tablist" aria-label="Onboarding method">
        <button type="button" role="tab" aria-selected={mode === 'single'} className={styles.modeTab} data-active={mode === 'single' || undefined} onClick={() => switchMode('single')}>
          Single member
        </button>
        <button type="button" role="tab" aria-selected={mode === 'bulk'} className={styles.modeTab} data-active={mode === 'bulk' || undefined} onClick={() => switchMode('bulk')}>
          Bulk upload
        </button>
      </div>

      {mode === 'single' ? (
        <>
          <p className={styles.note}>
            <strong>Company funding:</strong> {contributionFundingLabel(employer?.defaultContributionConfig)}.
          </p>
          <Field label="Full name">
            <input className={styles.input} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Jane Akello" aria-label="Full name" />
          </Field>
          <Field label="Phone">
            <input className={styles.input} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+256700000000" inputMode="tel" aria-label="Phone" />
          </Field>
          <Field label="Email (the invite link is shared here)">
            <input className={styles.input} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" inputMode="email" aria-label="Email" />
          </Field>
          <Field label="Monthly compensation (UGX)">
            <input className={styles.input} value={form.compensation} onChange={(e) => set('compensation', e.target.value)} placeholder="e.g. 800000" inputMode="numeric" type="number" min="0" aria-label="Monthly compensation in UGX" />
          </Field>
          {err && <p className={styles.err} role="alert">{err}</p>}
          <div className={styles.footer}>
            <button type="button" className={styles.ghost} onClick={onClose} disabled={createInvite.isPending}>Cancel</button>
            <button type="button" className={styles.primary} onClick={submit} disabled={createInvite.isPending} aria-busy={createInvite.isPending || undefined}>
              {createInvite.isPending ? 'Creating…' : 'Create invite link'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.note}>
            Onboard many members at once: download the template, fill one row per member
            (full name, phone, email, monthly compensation), then upload it to review and onboard.
          </p>
          <button type="button" className={styles.outlineBtn} onClick={downloadTemplate}>
            {DownloadIcon}<span>Download Excel template</span>
          </button>
          <div className={styles.dropzone}>
            <span className={styles.dropIcon} aria-hidden="true">{UploadIcon}</span>
            <button type="button" className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
              Upload filled template
            </button>
            <span className={styles.dropHint}>Excel or CSV — .xlsx, .xls, .csv</span>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className={styles.fileInput} onChange={onFile} aria-label="Upload filled template" />
          </div>
          {err && <p className={styles.err} role="alert">{err}</p>}
          <div className={styles.footer}>
            <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  // A div (not a label) wrapper: the inputs carry their own aria-label, so a
  // wrapping <label> would double-associate and trips jsx-a11y. The span is the
  // visible field label.
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}
