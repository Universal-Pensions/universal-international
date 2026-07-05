import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../utils/motion';

import { useAuth } from '../contexts/AuthContext';
import * as subscriberService from '../services/subscriber';
import { SignupProvider, useSignup } from './SignupContext';
import SignupShell, { STEPS, AGENT_STEP, PENDING_REVIEW_STEP, getStepIndex } from './SignupShell';
import ContributionRoute from './contribution/ContributionRoute';

import IdUploadStep from './steps/IdUploadStep';
import ReviewStep from './steps/ReviewStep';
import NiraStep from './steps/NiraStep';
import OtpStep from './steps/OtpStep';
import LivenessStep from './steps/LivenessStep';
import AmlStep from './steps/AmlStep';
import BeneficiariesStep from './steps/BeneficiariesStep';
import ConsentStep from './steps/ConsentStep';
import AgentFallbackStep from './steps/AgentFallbackStep';
import PendingReviewStep from './steps/PendingReviewStep';

// Back button is NOT shown on: Step 1 (start of flow), Step 9 (done), and
// either terminal screen. All other steps render a back link.
const NO_BACK_STEPS = new Set(['id-upload', 'done', AGENT_STEP, PENDING_REVIEW_STEP]);

// Steps that consume a re-uploadable File (idFront/idBack, selfie). The raw
// Resume gates: EPHEMERAL inputs dropped from localStorage on refresh (see
// SignupContext EPHEMERAL_KEYS), keyed on the persisted OUTCOME rather than the
// raw value. File steps: id-upload's OCR yields `idConfidence`, liveness' face
// match yields `faceMatchOutcome` — if the outcome is missing the user hadn't
// finished that step before the refresh and must re-do it; if present, the file
// already served its purpose downstream and need not be re-captured. Review: the
// chosen `password` is also ephemeral (raw passwords must never touch storage),
// so a refresh past Review must return to Review to re-enter it — otherwise the
// account would be created password-less (the pay guard in ContributionRoute
// blocks that create, but only Review has the field to re-enter). Listed in flow
// order; `done` is the predicate that the step's persisted result survived.
const RESUME_GATES = [
  { id: 'id-upload', done: (s) => s.idConfidence != null },
  { id: 'review',    done: (s) => !!s.password },
  { id: 'liveness',  done: (s) => s.faceMatchOutcome === 'ok' },
];

/**
 * Compute the step a refresh should rehydrate into. Persists wizard position
 * (BL-22) while preserving the documented demo-scope "re-do ephemeral steps on
 * refresh" behaviour: clamp the persisted `stepId` back to the first resume gate
 * (at or before it, in flow order) whose result didn't survive the refresh, so
 * the user can't resume past a gate they never actually cleared (an unfinished
 * file upload, or a lost password). A step already cleared (outcome persisted)
 * isn't re-walked. Terminal/failure screens (`agent`/`pending-review`, index -1)
 * and an unknown id restart at step 1.
 */
export function resolveResumeStep(persisted) {
  const targetIdx = getStepIndex(persisted?.stepId);
  if (targetIdx < 0) return 'id-upload';
  for (const gate of RESUME_GATES) {
    const gateIdx = getStepIndex(gate.id);
    if (gateIdx <= targetIdx && !gate.done(persisted)) return gate.id;
  }
  return persisted.stepId;
}

function SignupFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const signup = useSignup();
  // Lazy init from persisted context, clamped so a refresh resumes the wizard
  // position without skipping a now-empty file-upload gate (BL-22).
  const [stepId, setStepId] = useState(() => resolveResumeStep(signup));
  const [pausedAt, setPausedAt] = useState(null);
  const [direction, setDirection] = useState(1);

  // ── Employer-invite entry (/invite/:token) ────────────────────────────────
  // Pre-seed the flow from the invite token (identity prefill + the employer tag
  // + the schedule flag), then restart KYC at id-upload. On refresh the token
  // already matches the persisted invite → just resume. Reused steps + the
  // completion (ContributionRoute) read `signup.employerInvite`.
  const { token: inviteToken } = useParams();
  const [inviteReady, setInviteReady] = useState(!inviteToken);
  const [inviteError, setInviteError] = useState('');

  // Idiomatic StrictMode-safe fetch: a `cancelled` flag discards the first
  // (double-invoked) pass's result; the live pass applies it. No ref guard —
  // that deadlocks under StrictMode (ref blocks pass 2 while pass 1 is cancelled).
  useEffect(() => {
    if (!inviteToken) {
      // Plain /signup — an employerInvite is only ever valid inside the
      // /invite/:token/* tree. If one lingers in persisted state from an earlier
      // invite session, drop it: otherwise completion routes to
      // create_subscriber_from_employer_invite with a now-dead token and 500s
      // ("invite not found") instead of the correct self-signup RPC.
      if (signup.employerInvite) signup.patch({ employerInvite: null });
      return undefined;
    }
    if (signup.employerInvite?.token === inviteToken) { setInviteReady(true); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const inv = await subscriberService.getEmployerInvite(inviteToken);
        if (cancelled) return;
        signup.reset();
        signup.patch({
          fullName: inv.prefill?.fullName ?? '',
          phone: inv.prefill?.phone ?? '',
          email: inv.prefill?.email ?? '',
          nin: inv.prefill?.nin ?? '',
          gender: inv.prefill?.gender ?? null,
          employerInvite: {
            token: inviteToken,
            employerId: inv.employerId,
            employerName: inv.employerName,
            collectSchedule: inv.collectSchedule,
          },
          stepId: 'id-upload',
        });
        setStepId('id-upload');
        setInviteReady(true);
      } catch (e) {
        if (cancelled) return;
        setInviteError(e?.message || 'This invite link is invalid or has expired.');
        setInviteReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [inviteToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the user navigates to /signup/contribution, render the contribution
  // page in place of the signup shell. Keeping this check inside SignupFlow
  // (rather than splitting into separate Routes) means the signup flow's
  // internal step state survives the detour.
  const onContribution = location.pathname.replace(/\/$/, '').endsWith('/contribution');

  function goTo(nextId) {
    const currIdx = getStepIndex(stepId);
    const nextIdx = getStepIndex(nextId);
    setDirection(nextIdx >= currIdx ? 1 : -1);
    setStepId(nextId);
    // Persist wizard position so a mid-flow refresh resumes here (BL-22).
    // Terminal screens route via setStepId (not goTo) and are intentionally
    // NOT persisted — a refresh resumes the last real step before the terminal.
    signup.patch({ stepId: nextId });
  }

  function goNext() {
    const idx = getStepIndex(stepId);
    const next = STEPS[idx + 1];
    if (next) goTo(next.id);
  }

  function goBack() {
    const idx = getStepIndex(stepId);
    // Some beats auto-advance and have no manual control: the NIRA "Identity
    // verified" beat (on a successful match) and the AML "check passed" beat (on
    // a clear result) both auto-fire onNext on mount. Stepping back onto one
    // would immediately bounce forward again (a ~1s flicker), so skip over any
    // run of them to the previous real step.
    let prevIdx = idx - 1;
    while (
      prevIdx >= 0 &&
      ((STEPS[prevIdx].id === 'nira' && signup.niraResult === 'match') ||
        (STEPS[prevIdx].id === 'aml' && signup.amlResult === 'clear'))
    ) {
      prevIdx -= 1;
    }
    const prev = STEPS[prevIdx];
    if (prev) goTo(prev.id);
  }

  function routeToAgent(reason, stageId) {
    signup.patch({ failureReason: reason, failureStage: stageId });
    setPausedAt(stageId || stepId);
    setDirection(1);
    setStepId(AGENT_STEP);
  }

  function routeToPendingReview() {
    setPausedAt('aml');
    setDirection(1);
    setStepId(PENDING_REVIEW_STEP);
  }

  function exitToHome() {
    signup.reset();
    logout();
    navigate('/');
  }

  const canBack = !NO_BACK_STEPS.has(stepId);

  // Invite gate: wait for the token to resolve before rendering the flow (avoids
  // a flash of a stale/blank step), and show a friendly error for a bad token.
  if (inviteToken && !inviteReady && !inviteError) {
    return <InviteScreen title="Loading your invite…" />;
  }
  if (inviteError) {
    return (
      <InviteScreen
        title="Invite unavailable"
        body={inviteError}
        action={{ label: 'Go to home', href: '/' }}
      />
    );
  }

  const StepNode = renderStep();

  if (onContribution) {
    return <ContributionRoute />;
  }

  return (
    <SignupShell
      stepId={stepId}
      onBack={goBack}
      canBack={canBack}
      pinnedStageId={pausedAt}
    >
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={stepId}
          custom={direction}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{
            opacity: { duration: 0.35, ease: EASE_OUT_EXPO },
            y: { duration: 0.55, ease: EASE_OUT_EXPO },
          }}
        >
          {StepNode}
        </motion.div>
      </AnimatePresence>
    </SignupShell>
  );

  function renderStep() {
    switch (stepId) {
      case 'id-upload':
        return <IdUploadStep onNext={goNext} />;

      case 'review':
        return <ReviewStep onNext={goNext} />;

      case 'nira':
        return (
          <NiraStep
            onNext={goNext}
            onEdit={() => goTo('review')}
            onAgentFallback={() =>
              routeToAgent('NIRA could not verify your identity from the details provided.', 'nira')
            }
          />
        );

      case 'otp':
        return <OtpStep onNext={goNext} />;

      case 'liveness':
        return (
          <LivenessStep
            onNext={goNext}
            onAgentFallback={() =>
              routeToAgent('Biometric verification could not be completed.', 'liveness')
            }
          />
        );

      case 'aml':
        return <AmlStep onNext={goNext} onFlagged={routeToPendingReview} />;

      case 'beneficiaries':
        return <BeneficiariesStep onNext={goNext} />;

      // `consent` is the terminal step of this shell. Activating it does NOT
      // call goNext() into a `'done'` case here — instead it navigates to the
      // sibling `/signup/contribution` route, which mounts its own
      // <SignupShell stepId="done"> for the completion ring + ActivatedStep
      // (see contribution/ContributionRoute.jsx). So `STEPS` keeps its trailing
      // `'done'` entry — it is the wired terminal of the contribution route and
      // the end-of-flow sentinel for the agent OnboardKycFlow — but it has no
      // `case 'done'` in this switch by design. The `default` below returns
      // null only for that intentionally-unhandled id; nothing reaches it in
      // normal flow because consent navigates away instead of advancing.
      case 'consent':
        // Invite flow stays under /invite/:token/* so the contribution step keeps
        // the SAME provider (no remount, no lost in-memory state).
        return (
          <ConsentStep
            onActivate={async () =>
              navigate(inviteToken ? `/invite/${inviteToken}/contribution` : '/signup/contribution')
            }
          />
        );

      case AGENT_STEP:
        return <AgentFallbackStep onExit={exitToHome} />;

      case PENDING_REVIEW_STEP:
        return <PendingReviewStep onExit={exitToHome} />;

      default:
        return null;
    }
  }
}

/** Minimal centered screen for the invite loading + error states. */
function InviteScreen({ title, body, action }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center',
      background: 'var(--color-cloud)', fontFamily: 'var(--font-body)', color: 'var(--color-slate)',
    }}>
      <h2 style={{
        fontFamily: 'var(--font-display)', color: 'var(--color-indigo)', fontWeight: 800,
        letterSpacing: '-0.03em', margin: 0, fontSize: 'var(--text-xl)',
      }}>
        {title}
      </h2>
      {body && <p style={{ color: 'var(--color-gray)', maxWidth: 420, margin: 0, lineHeight: 1.6 }}>{body}</p>}
      {action && (
        <a href={action.href} style={{
          background: 'var(--color-indigo)', color: '#fff', borderRadius: 'var(--radius-full)',
          padding: '0.7rem 1.6rem', fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 'var(--text-sm)', textDecoration: 'none', marginTop: '0.25rem',
        }}>
          {action.label}
        </a>
      )}
    </div>
  );
}

export default function SignupPage() {
  return (
    <SignupProvider>
      <SignupFlow />
    </SignupProvider>
  );
}
