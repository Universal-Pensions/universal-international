import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Modal from '../../components/Modal';
import { useDashboard } from '../../contexts/DashboardContext';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { SUPPORT_EMAIL } from '../../config/env';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { downloadCsv } from '../../utils/csvDownload';
import { downloadSheet, parseSheet } from '../../utils/xlsx';
import {
  SETTLEMENT_TEMPLATE_COLUMNS,
  buildTemplateRows,
  normalizeUploadedRows,
  detectMissingColumns,
  describeSkippedReason,
} from '../../utils/settlement';
import {
  useCommissionRate, useSetCommissionRate,
  useCommissionSummary, useAgentCommissionList,
  useAgentCommissionDetail, useCommissionSubscribers,
  usePendingDuesByAgent, usePendingDuesByBranch,
  useSettlementsList, useApplySettlement,
} from '../../hooks/useCommission';
import { getInitials } from '../../utils/dashboard';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import styles from './CommissionPanel.module.css';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Icons                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */
const Icons = {
  close: (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  ),
  back: (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  search: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  edit: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M13.586 3.586a2 2 0 112.828 2.828L7 15.828 3 17l1.172-4L13.586 3.586z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  download: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <path d="M10 3v10M10 13l-3-3M10 13l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 15v2h14v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  upload: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <path d="M10 17V7M10 7l-3 3M10 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 5V3h14v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  chev: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

const viewAnim = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.25, ease: EASE_OUT_EXPO },
};

/**
 * Mint a per-upload idempotency nonce (BL-13). Prefers `crypto.randomUUID`;
 * falls back to a timestamp+random token in environments without it.
 */
function newSettlementNonce() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `nonce-${crypto.randomUUID()}`;
  }
  return `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  CommissionPanel                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function CommissionPanel({ splitMode = false, fullPage = false }) {
  const { commissionsOpen, setCommissionsOpen } = useDashboard();
  const { branchId } = useBranchScope();
  const { addToast } = useToast();

  const isBranch = !!branchId;
  const isDistributor = !branchId;

  // View state
  const [view, setView] = useState('home');
  const [statusFocus, setStatusFocus] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [subFilter, setSubFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [duesMode, setDuesMode] = useState('branch'); // 'branch' | 'agent'

  // Settlement upload confirm modal — holds the normalized upload result until
  // the distributor confirms. `null` while no upload is pending.
  // { rows: [...], skipped: [...] }
  const [pendingUpload, setPendingUpload] = useState(null);
  // Post-RPC settlement outcome, held so the confirm modal can show which rows
  // the server skipped (no_due / amount_too_low) with the agent name + a
  // concrete fix, instead of collapsing them into a count toast (BL-19). `null`
  // until a settlement has been applied this session.
  const [settlementResult, setSettlementResult] = useState(null);
  const fileInputRef = useRef(null);
  // Focus target for the single-panel-replace swap (§7c.3). Only one view's
  // motion.div is mounted at a time (AnimatePresence mode="wait"), so a single
  // ref reassigned per render points at the active view container.
  const viewRef = useRef(null);
  // Skip the first focus pass — the initial panel render shouldn't yank focus;
  // only an actual view swap should steer it.
  const didMountView = useRef(false);

  // Data hooks
  const { data: rate } = useCommissionRate();
  const setRateMutation = useSetCommissionRate();
  const { data: summary } = useCommissionSummary(branchId);
  const { data: agentList = [], isLoading: agentListLoading } = useAgentCommissionList(statusFocus);
  const { data: agentDetail } = useAgentCommissionDetail(selectedAgentId);
  const { data: subscribers = [] } = useCommissionSubscribers(selectedAgentId, subFilter);
  const { data: duesByBranch = [] } = usePendingDuesByBranch();
  const { data: duesByAgent = [] } = usePendingDuesByAgent();
  const { data: settlements = [] } = useSettlementsList({ limit: 20, branchId });
  const applySettlement = useApplySettlement();

  // Branch scope: pending dues by agent are filtered to this branch; the
  // distributor sees the whole network.
  const scopedDuesByAgent = useMemo(
    () => isBranch ? duesByAgent.filter((a) => a.branchId === branchId) : duesByAgent,
    [duesByAgent, branchId, isBranch]
  );
  const scopedAgentList = useMemo(
    () => isBranch ? agentList.filter((a) => a.branchId === branchId) : agentList,
    [agentList, branchId, isBranch]
  );

  // ── Contact-support mailto (mirror of the agent "Ask for reason" CTA) ──────
  // A client-side mailto to the back-office support mailbox (`SUPPORT_EMAIL`,
  // sourced from config/env), prefilled with the settlement context available
  // in this panel — how many agents still have outstanding dues and the total
  // owed (or the branch in scope for the branch read-only view). Demo-scope
  // affordance only (no backend integration). Subject + body are
  // encodeURIComponent-escaped, matching the agent CTA.
  const supportMailto = useMemo(() => {
    // Scope the agent count to the caller — the branch read-only view must not
    // leak network-wide context, so use the branch-scoped dues list there.
    const pendingAgents = scopedDuesByAgent.length;
    const outstanding = summary?.totalDue || 0;
    const subject = isBranch
      ? `Commission settlement support — ${branchId || 'branch'}`
      : 'Commission settlement support';
    const bodyLines = [
      `Hello,`,
      ``,
      `I have a question about commission settlement.`,
      ``,
      isBranch ? `Branch: ${branchId || '(unknown)'}` : `Scope: full network`,
      `Agents with outstanding dues: ${formatNumber(pendingAgents)}`,
      `Total outstanding: ${formatUGX(outstanding)}`,
      ``,
      `Could you help me with the following?`,
      ``,
      `Thank you.`,
    ];
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
  }, [isBranch, branchId, scopedDuesByAgent, summary]);

  // Reset state when panel closes
  useEffect(() => {
    if (commissionsOpen) return;
    const t = setTimeout(() => {
      setView('home');
      setStatusFocus(null);
      setSelectedAgentId(null);
      setSubFilter(null);
      setSearch('');
      setEditingRate(false);
      setDuesMode('branch');
      setPendingUpload(null);
      setSettlementResult(null);
    }, 400);
    return () => clearTimeout(t);
  }, [commissionsOpen]);

  // Escape closes the panel. The shared <Modal> primitive stops propagation
  // when a child modal is open, so this handler never fires while the confirm
  // modal is active — the modal closes first, then a second Escape closes the
  // panel.
  useEffect(() => {
    if (!commissionsOpen) return;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) setCommissionsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commissionsOpen, setCommissionsOpen, fullPage]);

  // Move focus to the newly shown view on a drill-down / back swap (§7c.3) so a
  // keyboard/SR user lands on the new content instead of <body> after the
  // triggering button unmounts. Mirrors SignupShell's focus-on-transition. The
  // first pass is skipped (panel-open render) and the ref is re-armed each time
  // the panel closes so a reopen doesn't yank focus on its first view.
  useEffect(() => {
    if (!commissionsOpen) {
      didMountView.current = false;
      return undefined;
    }
    if (!didMountView.current) {
      didMountView.current = true;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      viewRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, commissionsOpen]);

  // Debounce the agent-search input (the filter memo runs a lowercase pass over
  // the full agent list on every keystroke). 200ms matches the OverlayPanel.
  const debouncedSearch = useDebouncedValue(search, 200);

  const filteredAgents = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return scopedAgentList;
    return scopedAgentList.filter((a) =>
      a.agentName.toLowerCase().includes(q) || a.branchName.toLowerCase().includes(q)
    );
  }, [scopedAgentList, debouncedSearch]);

  const agentsCold = agentListLoading && scopedAgentList.length === 0;

  // Navigation
  function goHome() {
    setView('home');
    setStatusFocus(null);
    setSelectedAgentId(null);
    setSubFilter(null);
    setSearch('');
  }
  function goAgents(focus) { setStatusFocus(focus); setView('agents'); setSearch(''); }
  function goAgentDetail(agentId) { setSelectedAgentId(agentId); setView('agent-detail'); setSubFilter(null); }
  function goSubscribers(filter) { setSubFilter(filter); setView('subscribers'); }

  function handleBack() {
    if (view === 'subscribers') setView('agent-detail');
    else if (view === 'agent-detail') setView('agents');
    else if (view === 'agents') goHome();
  }

  function startEditRate() {
    setRateInput(String(rate || 5000));
    setEditingRate(true);
  }
  function saveRate() {
    const val = parseInt(rateInput);
    if (!isNaN(val) && val > 0) setRateMutation.mutate(val);
    setEditingRate(false);
  }

  // ── Download settlement template ──────────────────────────────────────────
  // Build a prefilled-per-agent template (one row per agent with a pending due)
  // and download it as `.xlsx`. Disabled when there are no pending dues.
  const handleDownloadTemplate = useCallback(async () => {
    if (duesByAgent.length === 0) {
      addToast('warning', 'No pending dues — nothing to settle.');
      return;
    }
    try {
      await downloadSheet({
        rows: buildTemplateRows(duesByAgent),
        columns: SETTLEMENT_TEMPLATE_COLUMNS,
        filename: 'commission-settlement-template',
        sheetName: 'Settlement',
      });
      addToast('success', `Template downloaded — ${formatNumber(duesByAgent.length)} agents with dues.`);
    } catch (err) {
      addToast('error', err?.message || 'Could not download the template.');
    }
  }, [duesByAgent, addToast]);

  // ── Upload settlement ──────────────────────────────────────────────────────
  // Parse the re-uploaded workbook, normalize it, and open the confirm modal.
  async function handleUploadFile(e) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-picked after a parse error.
    e.target.value = '';
    if (!file) return;
    const { rows, errors } = await parseSheet(file);
    if (errors.length) {
      // Surface the specific reason (oversize / wrong type / unreadable) rather
      // than a single opaque message — `parseSheet` returns a human-readable
      // first error.
      addToast('error', errors[0] || "Couldn't read the file — use the downloaded template.");
      return;
    }
    // Column-mapping check (C2): if the distributor renamed / removed the
    // headers the per-row pass would skip every row with an opaque reason. Call
    // out which columns were expected vs what the file actually carried so they
    // can fix the header instead of guessing.
    const mapping = detectMissingColumns(rows);
    if (!mapping.ok) {
      const foundNote = mapping.found.length
        ? ` Found: ${mapping.found.join(', ')}.`
        : '';
      addToast(
        'error',
        `Missing column${mapping.missing.length === 1 ? '' : 's'}: ${mapping.missing.join(', ')}. Use the downloaded template — don't rename the headers.${foundNote}`,
      );
      return;
    }
    const normalized = normalizeUploadedRows(rows);
    if (normalized.rows.length === 0 && normalized.skipped.length === 0) {
      addToast('warning', 'The file had no rows to settle.');
      return;
    }
    // Mint a per-upload idempotency nonce now (BL-13). It stays stable across a
    // Confirm retry / reopen of the confirm modal, so the server treats a replay
    // of the same upload as a no-op rather than recording a duplicate batch.
    setSettlementResult(null);
    setPendingUpload({ ...normalized, nonce: newSettlementNonce() });
  }

  async function handleConfirmSettlement() {
    if (!pendingUpload || pendingUpload.rows.length === 0) return;
    try {
      // Carry the per-upload idempotency nonce minted when the upload was
      // staged (BL-13): a reload / second-tab / retry replaying the same nonce
      // is a no-op server-side instead of double-recording the batch.
      const result = await applySettlement.mutateAsync({
        rows: pendingUpload.rows,
        nonce: pendingUpload.nonce,
      });
      const skipCount = result.skipped?.length || 0;
      const skippedNote = skipCount ? ` · ${formatNumber(skipCount)} skipped` : '';
      addToast(
        'success',
        `Settled ${formatNumber(result.agentsSettled)} agent${result.agentsSettled === 1 ? '' : 's'} · ${formatUGX(result.totalPaid)}${skippedNote}`,
      );
      // When the server skipped rows (no_due / amount_too_low), keep the modal
      // open on a result panel that names each skipped agent + the concrete fix
      // (BL-19) — a single-line toast can't carry that detail. With nothing
      // skipped, close straight out.
      if (skipCount > 0) {
        setSettlementResult(result);
      } else {
        setPendingUpload(null);
        setSettlementResult(null);
      }
    } catch (err) {
      addToast('error', err?.message || 'Could not apply the settlement.');
    }
  }

  function dismissSettlement() {
    setPendingUpload(null);
    setSettlementResult(null);
  }

  // ── Agent commission detail CSV download ──────────────────────────────────
  // Flatten paid + due transactions into one ledger CSV. Status is only
  // 'paid' / 'due' after the two-state collapse.
  const isMobile = useIsMobile();
  const handleAgentDetailDownload = useCallback(async () => {
    if (!agentDetail) return;
    const rows = [
      ...(agentDetail.paidTransactions || []).map((tx) => ({
        date: tx.transactionDate,
        subscriber: tx.subscriberName,
        amount: tx.amount,
        reference: tx.txnRef || '',
        status: 'Paid',
      })),
      ...(agentDetail.dueTransactions || []).map((tx) => ({
        date: tx.dueDate,
        subscriber: tx.subscriberName,
        amount: tx.amount,
        reference: '',
        status: 'Due',
      })),
    ];
    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'subscriber', label: 'Subscriber' },
      { key: 'amount', label: 'Amount (UGX)' },
      { key: 'reference', label: 'Reference' },
      { key: 'status', label: 'Status' },
    ];
    try {
      await downloadCsv({
        rows,
        columns,
        filename: `commissions-${agentDetail.agentName || 'agent'}-${agentDetail.agentId || ''}`,
        isMobile,
        onCapNotice: ({ capped, total }) => {
          addToast(
            'warning',
            `Showing first ${formatNumber(capped)} rows in export — refine your filter for full data (${formatNumber(total)} total).`,
          );
        },
      });
    } catch (err) {
      addToast('error', err?.message || 'Could not download commission ledger.');
    }
  }, [agentDetail, isMobile, addToast]);

  // Breadcrumb
  const breadcrumbItems = useMemo(() => {
    const items = [{ label: 'Commissions', view: 'home' }];
    if (view === 'agents' || view === 'agent-detail' || view === 'subscribers') {
      items.push({ label: statusFocus === 'paid' ? 'Paid' : statusFocus === 'due' ? 'Due' : 'All Agents', view: 'agents' });
    }
    if (view === 'agent-detail' || view === 'subscribers') {
      items.push({ label: agentDetail?.agentName || '…', view: 'agent-detail' });
    }
    if (view === 'subscribers') {
      items.push({ label: subFilter === 'active' ? 'Active Subscribers' : subFilter === 'dormant' ? 'Dormant' : 'Subscribers', view: 'subscribers' });
    }
    return items;
  }, [view, statusFocus, agentDetail, subFilter]);

  const titles = {
    home: {
      title: 'Commissions',
      subtitle: isBranch ? 'Your branch commission summary' : 'Settle agent commissions',
    },
    agents: {
      title: statusFocus === 'paid' ? 'Commissions Paid' : statusFocus === 'due' ? 'Commissions Due' : 'Total Commissions',
      subtitle: `${filteredAgents.length} agents`,
    },
    'agent-detail': { title: agentDetail?.agentName || '…', subtitle: agentDetail?.branchName || '' },
    subscribers: {
      title: subFilter === 'active' ? 'Active Subscribers' : subFilter === 'dormant' ? 'Dormant Subscribers' : 'Subscribers',
      subtitle: `${subscribers.length} subscribers`,
    },
  };
  const { title, subtitle } = titles[view] || titles.home;

  // ── Confirm-modal summary ──────────────────────────────────────────────────
  // Computed from the normalized rows + current per-agent pending dues:
  //   - agentCount / sum amountPaid / sum matched pendingCount;
  //   - mismatches: entered Amount Paid ≠ the agent's current pending total;
  //   - skipped rows (missing id / no amount).
  const confirmSummary = useMemo(() => {
    if (!pendingUpload) return null;
    const pendingMap = new Map(duesByAgent.map((a) => [a.agentId, a]));
    let totalPaid = 0;
    let matchedLines = 0;
    const mismatches = [];
    for (const row of pendingUpload.rows) {
      totalPaid += row.amountPaid;
      const pending = pendingMap.get(row.agentId);
      if (pending) {
        matchedLines += pending.pendingCount || 0;
        if (Math.round(row.amountPaid) !== Math.round(pending.pendingAmount || 0)) {
          mismatches.push({
            agentId: row.agentId,
            agentName: pending.agentName || row.agentId,
            entered: row.amountPaid,
            pending: pending.pendingAmount || 0,
          });
        }
      }
    }
    return {
      agentCount: pendingUpload.rows.length,
      totalPaid,
      matchedLines,
      mismatches,
      skipped: pendingUpload.skipped,
    };
  }, [pendingUpload, duesByAgent]);

  // Resolve an agent id to a display name from the current pending-dues data
  // (falls back to the id when the agent carries no remaining due — e.g. a
  // 'no_due' skip — so the line still reads meaningfully).
  const agentNameById = useCallback(
    (agentId) => duesByAgent.find((a) => a.agentId === agentId)?.agentName || agentId || '(blank)',
    [duesByAgent],
  );

  return (
    <AnimatePresence>
      {(commissionsOpen || fullPage) && (
        <>
          {!splitMode && !fullPage && (
            <motion.div
              className={styles.backdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setCommissionsOpen(false)}
            />
          )}

          <motion.div
            className={styles.panel}
            data-split-mode={splitMode || undefined}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={fullPage ? { opacity: 0 } : { x: '100%', transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            role={fullPage ? undefined : 'dialog'}
            aria-modal={fullPage ? undefined : 'true'}
            aria-label="Commissions"
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                {view !== 'home' && (
                  <button className={styles.backBtn} onClick={handleBack} aria-label="Go back">
                    {Icons.back}
                  </button>
                )}
                <div className={styles.titleWrap}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={title}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={styles.title}>{title}</div>
                      <div className={styles.subtitle}>{subtitle}</div>
                    </motion.div>
                  </AnimatePresence>
                </div>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={() => setCommissionsOpen(false)} aria-label="Close commissions">
                    {Icons.close}
                  </button>
                )}
              </div>
            </div>

            {view !== 'home' && (
              <div className={styles.breadcrumb}>
                {breadcrumbItems.map((item, i) => (
                  <span key={item.view + i}>
                    {i > 0 && <span className={styles.breadcrumbSep}> / </span>}
                    <button
                      className={styles.breadcrumbItem}
                      data-active={i === breadcrumbItems.length - 1}
                      onClick={() => {
                        if (item.view === 'home') goHome();
                        else if (item.view === 'agents') setView('agents');
                        else if (item.view === 'agent-detail') setView('agent-detail');
                      }}
                    >
                      {item.label}
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className={styles.body}>
              <AnimatePresence mode="wait">
                {/* ─── HOME VIEW ─────────────────────────────────────── */}
                {view === 'home' && (
                  <motion.div key="home" ref={viewRef} tabIndex={-1} {...viewAnim}>
                    {/* ── Rate per subscriber (distributor only) ── */}
                    {isDistributor && (
                      <div className={styles.cadenceCard} style={{ marginBottom: 'var(--space-4)' }}>
                        <div className={styles.cadenceHead}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className={styles.cadenceEyebrow}>Rate per subscriber</div>
                            {editingRate ? (
                              <div className={styles.rateEditRow} style={{ marginTop: 6 }}>
                                <input
                                  className={styles.rateInput}
                                  type="number"
                                  value={rateInput}
                                  onChange={(e) => setRateInput(e.target.value)}
                                  aria-label="Commission rate in UGX"
                                  autoFocus
                                />
                                <button className={styles.rateSaveBtn} onClick={saveRate}>Save</button>
                                <button className={styles.rateCancelBtn} onClick={() => setEditingRate(false)}>Cancel</button>
                              </div>
                            ) : (
                              <>
                                <div className={styles.cadenceValue}>{formatUGX(rate || 0)}</div>
                                <div className={styles.cadenceSub}>Paid for every first-contribution onboarding</div>
                              </>
                            )}
                          </div>
                          {!editingRate && (
                            <button
                              className={styles.rateEditBtn}
                              onClick={startEditRate}
                              aria-label="Edit commission rate"
                            >
                              {Icons.edit}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Summary strip ── */}
                    <div className={styles.summaryStrip}>
                      <button className={styles.summaryItem} onClick={() => goAgents(null)}>
                        <span className={styles.summaryItemLabel}>Total</span>
                        <span className={styles.summaryItemValue}>{formatUGXShort(summary?.totalCommissions || 0)}</span>
                        <span className={styles.summaryItemCount}>{formatNumber(summary?.countTotal || 0)} records</span>
                      </button>
                      <button className={styles.summaryItem} onClick={() => goAgents('paid')}>
                        <span className={styles.summaryItemLabel}>Settled</span>
                        <span className={styles.summaryItemValue}>{formatUGXShort(summary?.totalPaid || 0)}</span>
                        <span className={styles.summaryItemCount}>{formatNumber(summary?.countPaid || 0)} paid</span>
                      </button>
                      <button className={styles.summaryItem} onClick={() => goAgents('due')}>
                        <span className={styles.summaryItemLabel}>Outstanding</span>
                        <span className={styles.summaryItemValue}>{formatUGXShort(summary?.totalDue || 0)}</span>
                        <span className={styles.summaryItemCount}>{formatNumber(summary?.countDue || 0)} owed</span>
                      </button>
                    </div>

                    {/* ── Settle actions (distributor only) ── */}
                    {isDistributor && (
                      <div className={styles.actionRow}>
                        <button
                          className={styles.actionBtn}
                          data-variant="secondary"
                          onClick={handleDownloadTemplate}
                          disabled={duesByAgent.length === 0}
                          type="button"
                        >
                          {Icons.download}
                          Download template
                        </button>
                        <button
                          className={styles.actionBtn}
                          data-variant="primary"
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                        >
                          {Icons.upload}
                          Upload settlement
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={handleUploadFile}
                          style={{ display: 'none' }}
                          aria-hidden="true"
                          tabIndex={-1}
                        />
                      </div>
                    )}

                    {/* ── Pending dues ── */}
                    <div className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <span className={styles.sectionTitle}>Pending dues</span>
                        {isDistributor && (
                          <div className={styles.duesToggle} role="tablist" aria-label="Group pending dues by">
                            <button
                              className={styles.duesToggleBtn}
                              data-active={duesMode === 'branch'}
                              onClick={() => setDuesMode('branch')}
                              role="tab"
                              aria-selected={duesMode === 'branch'}
                            >
                              Branch
                            </button>
                            <button
                              className={styles.duesToggleBtn}
                              data-active={duesMode === 'agent'}
                              onClick={() => setDuesMode('agent')}
                              role="tab"
                              aria-selected={duesMode === 'agent'}
                            >
                              Agent
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Branch view (distributor only) */}
                      {isDistributor && duesMode === 'branch' && (
                        duesByBranch.length === 0 ? (
                          <div className={styles.empty}>No pending dues</div>
                        ) : (
                          duesByBranch.map((b) => (
                            <div key={b.branchId} className={styles.runRow}>
                              <div className={styles.runRowMain}>
                                <div className={styles.runRowTitle}>{b.branchName}</div>
                                <div className={styles.runRowSub}>
                                  {formatNumber(b.agentCount)} agent{b.agentCount === 1 ? '' : 's'} · {formatNumber(b.pendingCount)} line{b.pendingCount === 1 ? '' : 's'}
                                </div>
                              </div>
                              <div className={styles.runRowAmount}>{formatUGX(b.pendingAmount)}</div>
                            </div>
                          ))
                        )
                      )}

                      {/* Agent view (distributor agent toggle OR branch read-only) */}
                      {(isBranch || duesMode === 'agent') && (
                        scopedDuesByAgent.length === 0 ? (
                          <div className={styles.empty}>No pending dues</div>
                        ) : (
                          scopedDuesByAgent.map((a) => (
                            <button
                              key={a.agentId}
                              className={styles.agentRow}
                              onClick={() => goAgentDetail(a.agentId)}
                            >
                              <div className={styles.agentAvatar}>{getInitials(a.agentName)}</div>
                              <div className={styles.agentInfo}>
                                <div className={styles.agentName}>{a.agentName}</div>
                                <div className={styles.agentBranch}>
                                  {a.branchName} · {formatNumber(a.pendingCount)} line{a.pendingCount === 1 ? '' : 's'}
                                </div>
                              </div>
                              <div className={styles.agentAmount}>{formatUGXShort(a.pendingAmount)}</div>
                            </button>
                          ))
                        )
                      )}
                    </div>

                    {/* ── Settlement history ── */}
                    <div className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <span className={styles.sectionTitle}>Settlement history</span>
                        {/* Contact-support mailto — mirror of the agent "Ask for
                         * reason" CTA. Demo affordance: a prefilled client-side
                         * mailto to SUPPORT_EMAIL, no backend integration. */}
                        <a className={styles.supportCta} href={supportMailto}>
                          Contact support
                        </a>
                      </div>
                      {settlements.length === 0 ? (
                        <div className={styles.empty}>No settlements yet</div>
                      ) : (
                        settlements.map((s) => (
                          <div key={s.id} className={styles.runRow}>
                            <div className={styles.runRowMain}>
                              <div className={styles.runRowTitle}>{isBranch ? s.agentName : `${s.agentName} · ${s.branchName}`}</div>
                              <div className={styles.runRowSub}>
                                {formatNumber(s.lineCount)} line{s.lineCount === 1 ? '' : 's'}
                                {s.txnRef ? ` · ${s.txnRef}` : ''}
                                {s.paidDate ? ` · ${formatDate(s.paidDate)}` : ''}
                              </div>
                            </div>
                            <div className={styles.runRowAmount}>{formatUGX(s.paidAmount)}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ─── AGENTS VIEW ───────────────────────────────────── */}
                {view === 'agents' && (
                  <motion.div key="agents" ref={viewRef} tabIndex={-1} {...viewAnim}>
                    <div className={styles.toolbar}>
                      <div className={styles.searchWrap}>
                        <span className={styles.searchIcon}>{Icons.search}</span>
                        <input
                          className={styles.searchInput}
                          placeholder="Search agents…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          aria-label="Search agents"
                          spellCheck={false}
                        />
                        {search && (
                          <button className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
                            {Icons.close}
                          </button>
                        )}
                      </div>
                    </div>

                    {agentsCold ? (
                      <SkeletonRow count={6} label="Loading commission ledger" />
                    ) : filteredAgents.length === 0 ? (
                      debouncedSearch.trim() === '' ? (
                        <EmptyState
                          kind="no-data"
                          title={
                            statusFocus === 'paid'
                              ? 'No commissions paid yet.'
                              : statusFocus === 'due'
                                ? 'No commissions due.'
                                : 'No commissions yet.'
                          }
                          body="Commission activity will appear here as soon as it's recorded."
                        />
                      ) : (
                        <EmptyState
                          kind="no-match"
                          title="No agents match"
                          body="Try adjusting your search."
                        />
                      )
                    ) : (
                      filteredAgents.map((agent) => (
                        <button
                          key={agent.agentId}
                          className={styles.agentRow}
                          onClick={() => goAgentDetail(agent.agentId)}
                        >
                          <div className={styles.agentAvatar}>{getInitials(agent.agentName)}</div>
                          <div className={styles.agentInfo}>
                            <div className={styles.agentName}>{agent.agentName}</div>
                            <div className={styles.agentBranch}>{agent.branchName}{agent.employeeId ? ` · ${agent.employeeId}` : ''}</div>
                          </div>
                          <div>
                            <div className={styles.agentAmount}>
                              {statusFocus === 'paid' ? formatUGXShort(agent.totalPaid) :
                               statusFocus === 'due' ? formatUGXShort(agent.totalDue) :
                               formatUGXShort(agent.totalCommissions)}
                            </div>
                            <div className={styles.agentAmountLabel}>
                              {agent.subscribersOnboarded} subscribers
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </motion.div>
                )}

                {/* ─── AGENT DETAIL VIEW ─────────────────────────────── */}
                {view === 'agent-detail' && agentDetail && (
                  <motion.div key="agent-detail" ref={viewRef} tabIndex={-1} {...viewAnim}>
                    <div className={styles.detailHeader}>
                      <div className={styles.detailAvatar}>{getInitials(agentDetail.agentName)}</div>
                      <div className={styles.detailInfo}>
                        <div className={styles.detailName}>{agentDetail.agentName}</div>
                        <div className={styles.detailBranch}>{agentDetail.branchName}{agentDetail.employeeId ? ` · ${agentDetail.employeeId}` : ''}</div>
                      </div>
                    </div>

                    <div className={styles.detailStats}>
                      <button className={styles.detailStat} onClick={() => goSubscribers(null)}>
                        <div className={styles.detailStatLabel}>Onboarded</div>
                        <div className={styles.detailStatValue}>{agentDetail.subscribersOnboarded}</div>
                      </button>
                      <button className={styles.detailStat} onClick={() => goSubscribers('active')}>
                        <div className={styles.detailStatLabel}>Active</div>
                        <div className={styles.detailStatValue} data-color="green">{agentDetail.activeSubscribers}</div>
                      </button>
                      <button className={styles.detailStat} onClick={() => goSubscribers('dormant')}>
                        <div className={styles.detailStatLabel}>Dormant</div>
                        <div className={styles.detailStatValue}>{agentDetail.dormantSubscribers}</div>
                      </button>
                    </div>

                    <div className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <span className={styles.sectionTitle}>Commissions Paid</span>
                          <span className={styles.sectionCount}> — {formatUGX(agentDetail.totalPaid)}</span>
                        </div>
                      </div>
                      {agentDetail.paidTransactions.slice(0, 5).map((tx) => (
                        <div key={tx.id} className={styles.txRow}>
                          <div className={styles.txDate}>{formatDate(tx.transactionDate)}</div>
                          <div className={styles.txName}>{tx.subscriberName}</div>
                          <div className={styles.txAmount} data-status="paid">{formatUGX(tx.amount)}</div>
                          <div className={styles.txBadge} data-confirmed="true">Paid</div>
                        </div>
                      ))}
                      {agentDetail.paidTransactions.length > 5 && (
                        <div className={styles.sectionAction}>
                          +{agentDetail.paidTransactions.length - 5} more transactions
                        </div>
                      )}
                      {agentDetail.paidTransactions.length === 0 && (
                        <div className={styles.empty}>No commissions paid yet</div>
                      )}
                    </div>

                    <div className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <span className={styles.sectionTitle}>Outstanding</span>
                          <span className={styles.sectionCount}> — {formatUGX(agentDetail.totalDue)}</span>
                        </div>
                      </div>
                      {agentDetail.dueTransactions.slice(0, 5).map((tx) => (
                        <div key={tx.id} className={styles.txRow}>
                          <div className={styles.txDate}>{formatDate(tx.dueDate)}</div>
                          <div className={styles.txName}>{tx.subscriberName}</div>
                          <div className={styles.txAmount} data-status="due">{formatUGX(tx.amount)}</div>
                          <div className={styles.txBadge} data-confirmed="false">Due</div>
                        </div>
                      ))}
                      {agentDetail.dueTransactions.length > 5 && (
                        <div className={styles.sectionAction}>
                          +{agentDetail.dueTransactions.length - 5} more outstanding
                        </div>
                      )}
                      {agentDetail.dueTransactions.length === 0 && (
                        <div className={styles.empty}>No outstanding commissions</div>
                      )}
                    </div>

                    <button
                      className={styles.downloadBtn}
                      onClick={handleAgentDetailDownload}
                      aria-label="Download commission ledger as CSV"
                      type="button"
                    >
                      {Icons.download}
                      Download
                    </button>
                  </motion.div>
                )}

                {/* ─── SUBSCRIBERS VIEW ──────────────────────────────── */}
                {view === 'subscribers' && (
                  <motion.div key="subscribers" ref={viewRef} tabIndex={-1} {...viewAnim}>
                    <div className={styles.filterPills}>
                      <button className={styles.filterPill} data-active={!subFilter} onClick={() => setSubFilter(null)}>All</button>
                      <button className={styles.filterPill} data-active={subFilter === 'active'} onClick={() => setSubFilter('active')}>Active</button>
                      <button className={styles.filterPill} data-active={subFilter === 'dormant'} onClick={() => setSubFilter('dormant')}>Dormant</button>
                    </div>

                    {subscribers.length === 0 ? (
                      <div className={styles.empty}>No subscribers found</div>
                    ) : (
                      subscribers.map((sub) => (
                        <div key={sub.subscriberId} className={styles.subRow}>
                          <span className={styles.subStatusDot} data-active={sub.isActive} />
                          <div className={styles.subName}>
                            <div className={styles.subNameText}>{sub.subscriberName}</div>
                            <div className={styles.subId}>{sub.subscriberId} — Joined {formatDate(sub.registeredDate)}</div>
                          </div>
                          <div className={styles.subMeta}>
                            <div className={styles.subAmount}>{formatUGX(sub.totalContributions)}</div>
                            {sub.lastContributionDate ? (
                              <div className={styles.subDate}>Last: {formatDate(sub.lastContributionDate)}</div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </motion.div>
        </>
      )}

      {/* Settlement confirm modal — portals to <body> via the shared <Modal>
       * primitive (focus trap, scroll-lock, ESC + backdrop). The
       * `commissionsOpen` gate unmounts it when the parent panel closes. */}
      {commissionsOpen && confirmSummary && (
        <Modal
          open={Boolean(pendingUpload)}
          onClose={() => {
            if (!applySettlement.isPending) dismissSettlement();
          }}
          title={settlementResult ? 'Settlement applied' : 'Confirm settlement'}
          size="md"
          dismissOnBackdrop={!applySettlement.isPending}
        >
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                {settlementResult ? 'Settlement applied' : 'Confirm settlement'}
              </div>
              <div className={styles.modalSubtitle}>
                {settlementResult
                  ? 'The settlement was applied. Some rows were skipped — review them below and re-upload to settle them.'
                  : 'Settles each agent’s oldest due commissions up to the amount paid. Anything the amount doesn’t cover stays outstanding.'}
              </div>
            </div>
            <div className={styles.modalBody}>
              {settlementResult ? (
                /* ── Post-settlement result: name each skipped row + its fix (BL-19) ── */
                <>
                  <div className={styles.modalSummary}>
                    <div className={styles.modalSummaryLabel}>
                      Settled {formatNumber(settlementResult.agentsSettled)} agent{settlementResult.agentsSettled === 1 ? '' : 's'} · {formatNumber(settlementResult.linesSettled || 0)} line{settlementResult.linesSettled === 1 ? '' : 's'}
                    </div>
                    <div className={styles.modalSummaryValue}>{formatUGX(settlementResult.totalPaid)}</div>
                  </div>

                  <div className={styles.modalConsequence} data-action="reject">
                    <div className={styles.modalConsequenceLabel}>
                      {formatNumber(settlementResult.skipped.length)} row{settlementResult.skipped.length === 1 ? '' : 's'} skipped
                    </div>
                    {settlementResult.skipped.slice(0, 6).map((s, i) => {
                      const { label, fix } = describeSkippedReason(s.reason);
                      return (
                        <p key={`${s.agentId ?? 'na'}-${i}`} className={styles.modalConsequenceLine}>
                          <strong>{agentNameById(s.agentId)}</strong>: {label}{fix ? ` — ${fix}` : ''}
                        </p>
                      );
                    })}
                    {settlementResult.skipped.length > 6 && (
                      <p className={styles.modalConsequenceLine}>
                        +{settlementResult.skipped.length - 6} more
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.modalSummary}>
                    <div className={styles.modalSummaryLabel}>
                      Settle {formatNumber(confirmSummary.agentCount)} agent{confirmSummary.agentCount === 1 ? '' : 's'} · {formatNumber(confirmSummary.matchedLines)} line{confirmSummary.matchedLines === 1 ? '' : 's'}
                    </div>
                    <div className={styles.modalSummaryValue}>{formatUGX(confirmSummary.totalPaid)}</div>
                  </div>

                  {confirmSummary.mismatches.length > 0 && (
                    <div className={styles.modalConsequence} data-action="reject">
                      <div className={styles.modalConsequenceLabel}>
                        {formatNumber(confirmSummary.mismatches.length)} amount mismatch{confirmSummary.mismatches.length === 1 ? '' : 'es'}
                      </div>
                      {confirmSummary.mismatches.slice(0, 6).map((m) => (
                        <p key={m.agentId} className={styles.modalConsequenceLine}>
                          <strong>{m.agentName}</strong>: entered {formatUGX(m.entered)} vs pending {formatUGX(m.pending)}
                          {m.entered < m.pending ? ' — only the covered lines settle; the rest stay due' : ''}
                        </p>
                      ))}
                      {confirmSummary.mismatches.length > 6 && (
                        <p className={styles.modalConsequenceLine}>
                          +{confirmSummary.mismatches.length - 6} more
                        </p>
                      )}
                    </div>
                  )}

                  {confirmSummary.skipped.length > 0 && (
                    <div className={styles.modalConsequence}>
                      <div className={styles.modalConsequenceLabel}>
                        {formatNumber(confirmSummary.skipped.length)} row{confirmSummary.skipped.length === 1 ? '' : 's'} skipped
                      </div>
                      {confirmSummary.skipped.slice(0, 6).map((s, i) => {
                        const { label, fix } = describeSkippedReason(s.reason);
                        return (
                          <p key={`${s.agentId ?? 'na'}-${i}`} className={styles.modalConsequenceLine}>
                            <strong>{s.agentId || '(blank)'}</strong>: {label}{fix ? ` — ${fix}` : ''}
                          </p>
                        );
                      })}
                      {confirmSummary.skipped.length > 6 && (
                        <p className={styles.modalConsequenceLine}>
                          +{confirmSummary.skipped.length - 6} more
                        </p>
                      )}
                    </div>
                  )}

                  <div className={styles.modalHint}>
                    {confirmSummary.mismatches.length > 0
                      ? 'Some entered amounts don’t match the agent’s outstanding dues. Settling now applies the FIFO rule above — uncovered due lines stay Outstanding. Double-check before settling.'
                      : 'Agents (and their branches) are notified once the settlement is applied.'}
                  </div>
                </>
              )}
            </div>
            <div className={styles.modalActions}>
              {settlementResult ? (
                <button
                  className={styles.modalConfirmBtn}
                  onClick={dismissSettlement}
                  type="button"
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    className={styles.modalBackBtn}
                    onClick={dismissSettlement}
                    disabled={applySettlement.isPending}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.modalConfirmBtn}
                    data-variant={confirmSummary.mismatches.length > 0 ? 'caution' : undefined}
                    onClick={handleConfirmSettlement}
                    disabled={confirmSummary.agentCount === 0 || applySettlement.isPending}
                    type="button"
                  >
                    {applySettlement.isPending
                      ? 'Settling…'
                      : confirmSummary.mismatches.length > 0
                        ? 'Settle despite mismatches'
                        : 'Confirm settlement'}
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  );
}
