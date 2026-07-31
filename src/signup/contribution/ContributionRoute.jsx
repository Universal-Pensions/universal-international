import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSignup } from '../SignupContext';
import * as subscriberService from '../../services/subscriber';
import { verifyOtp } from '../../services/auth';
import { toCanonicalUGPhone } from '../../utils/phone';
import { buildContributionPayload } from './contributionPayload';
import ContributionSettings from './ContributionSettings';
import SignupShell from '../SignupShell';
import ActivatedStep from '../steps/ActivatedStep';
import { warmupBackend } from '../../components/WarmupBanner';

/**
 * Route wrapper for `/signup/contribution`.
 *
 * Reads the existing schedule (if any) from the signup context so editing
 * pre-fills. On payment confirm, calls the atomic
 * `create_subscriber_from_signup` RPC (via `subscriber.createFromSignup`) to
 * persist the subscriber + balance + schedule + nominees + first transaction
 * in one transaction, then mints the real JWT via `/api/auth/verify-otp`.
 * Once the JWT is set, the route captures a `completionSnapshot` of the
 * fields the All-Set view needs and flips into the `'activated'` phase.
 * `ActivatedStep` reads from the snapshot rather than the live signup
 * context, so it stays renderable even after `signup.reset()` fires on
 * Continue — that ordering matters because the activated branch is checked
 * BEFORE the direct-entry consent guard, preventing a redirect race that
 * would otherwise bounce the user back to ConsentStep.
 */
export default function ContributionRoute() {
  const navigate = useNavigate();
  const signup = useSignup();
  const { login } = useAuth();
  const { addToast } = useToast();
  const [phase, setPhase] = useState('setup');
  const [completionSnapshot, setCompletionSnapshot] = useState(null);

  // Pre-warm the Render backend on mount. The user spends a while here choosing a
  // plan + payment method, and an idle instance cold-starts; warming now means the
  // verify-otp call at the end of "Pay" resolves within budget instead of timing
  // out (the "sign-in failed right after Pay, but works on reload" symptom).
  useEffect(() => { warmupBackend(); }, []);

  // Activated branch runs FIRST — independent of signup context so the
  // Continue click (which resets signup) can't trigger the guard below
  // during the brief window before route unmount.
  if (phase === 'activated' && completionSnapshot) {
    return (
      <SignupShell stepId="done" canBack={false}>
        <ActivatedStep snapshot={completionSnapshot} onFinish={handleContinue} />
      </SignupShell>
    );
  }

  if (!signup.consent || !signup.consentTimestamp || !signup.fullName) {
    return <Navigate to="/signup" replace />;
  }

  async function handleConfirm(schedule) {
    // The chosen password is held in memory only (never persisted — see
    // SignupContext EPHEMERAL_KEYS). A mid-flow refresh clears it; without it the
    // create below would stamp a password-less account the member could never
    // sign into. It's required at ReviewStep for every flow, so an empty value
    // here can only mean it was lost on refresh — send them back to Review to
    // re-enter it rather than minting a credential-less account.
    if (!signup.password) {
      addToast('error', 'For your security, please re-enter your password to finish setting up your account.');
      // Leaving /contribution renders the wizard shell, which resumeGates has
      // already clamped to Review (password is an ephemeral resume-gate — see
      // resolveResumeStep), so the user lands on the step that has the field.
      // Persist the clamp too, and keep invite users on their /invite/:token base.
      signup.patch({ stepId: 'review' });
      const inviteToken = signup.employerInvite?.token;
      navigate(inviteToken ? `/invite/${inviteToken}` : '/signup');
      return;
    }
    const canonicalPhone = toCanonicalUGPhone(signup.phone) || signup.phone;
    signup.patch({ contributionSchedule: schedule });

    const payload = buildContributionPayload(signup, schedule, canonicalPhone);

    // 1. Atomic write: subscriber + schedule + nominees + first transaction +
    //    optional insurance policy. Trigger chain populates subscriber_balances
    //    and commissions. RPC rolls back on any validation failure, so no
    //    orphan rows are possible.
    let subscriberId = null;
    try {
      // Pass the stable per-attempt nonce so a double-submit / reload / retry
      // replays idempotently (0042) rather than minting a duplicate subscriber.
      // Employer invites complete via a DIFFERENT RPC that tags the employer and
      // passes agent_id NULL (no commission) — never createFromSignup (which
      // tags a-001 and fires a commission).
      const invite = signup.employerInvite;
      const result = invite?.token
        ? await subscriberService.createFromEmployerInvite(payload, invite.token, signup.signupNonce)
        : await subscriberService.createFromSignup(payload, signup.signupNonce);
      subscriberId = result?.subscriberId;
    } catch (err) {
      // Log so the actual RPC error is visible during demos — Supabase RPC
      // errors often carry useful detail in `err.details` / `err.hint` /
      // `err.code` that the toast's top-level message hides. Covers both the
      // self-signup and employer-invite create paths.
      console.error('[signup] account creation failed', err);
      addToast(
        'error',
        err?.message || "Couldn't create your account. Please try again.",
      );
      // Re-throw so ContributionSettings' `await onConfirm(...)` rejects and
      // resets its `processing` state — otherwise the Pay button stays stuck on
      // "Processing…" with no way to retry.
      throw err;
    }

    // 2. Mint the real JWT via the dev-bypass verify-otp route. The subscriber
    //    row now exists, so the route's phone lookup succeeds and the JWT
    //    carries the correct subscriberId claim. We also ship the chosen
    //    password (captured at ReviewStep, held in memory only) so the backend
    //    stamps `users.password_hash` on the same upsert — the returned user
    //    object carries `hasPassword: true` for the persisted auth state.
    try {
      const { token, user } = await verifyOtp(
        canonicalPhone,
        '123456',
        'subscriber',
        signup.password,
      );
      await login({ token, user });
      // Create + verify both succeeded → the nonce is spent. Rotate it now (not
      // only on the Finish→reset path) so that if the user closes the tab before
      // clicking Continue, a later signup on the same browser can't replay this
      // nonce and idempotently return THIS subscriber's id. Safe here because no
      // further createFromSignup runs in this flow; a verify-only retry never
      // reaches this line.
      signup.rotateSignupNonce();
    } catch (err) {
      console.error('[signup] verifyOtp / login failed', err);
      addToast(
        'error',
        err?.message || 'Account created, but sign-in failed. Please sign in to continue.',
      );
      throw err;
    }

    // 3. Capture a snapshot of the fields the All-Set view needs (so the view
    //    survives `signup.reset()` on Continue), then flip into the
    //    `'activated'` phase. `subscriberId` is referenced for diagnostics;
    //    the auth-context JWT already carries it.
    void subscriberId;
    setCompletionSnapshot({
      fullName: signup.fullName,
      phone: canonicalPhone,
      dob: signup.dob,
      gender: signup.gender,
      contributionSchedule: schedule,
      insuranceBeneficiaries: signup.insuranceBeneficiaries ?? [],
    });
    setPhase('activated');
  }

  function handleCancel() {
    // Return to the invite flow (not a fresh signup) when in invite mode.
    const inviteToken = signup.employerInvite?.token;
    navigate(inviteToken ? `/invite/${inviteToken}` : '/signup');
  }

  function handleContinue() {
    signup.reset();
    navigate('/dashboard', { replace: true });
  }

  return (
    <ContributionSettings
      initial={signup.contributionSchedule}
      dob={signup.dob}
      phone={signup.phone}
      // KYC DEPTH, not funding. Self-signup (no invite) always collects the full
      // schedule; an employer invite carries the flag through from the invite RPC
      // (constant TRUE since migration 0092), which decides how complete a record
      // to collect — NOT who pays. An invited member never states an amount:
      // their employer's config sets both amounts, and
      // `create_subscriber_from_employer_invite` writes the schedule at 0 and
      // skips the signup deposit on either branch.
      collectSchedule={signup.employerInvite ? signup.employerInvite.collectSchedule : true}
      onClose={handleCancel}
      onConfirm={handleConfirm}
    />
  );
}
