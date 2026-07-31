import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { useAuth } from '../../contexts/AuthContext';
import { faceMatch } from '../../services/kyc';
import styles from './Step.module.css';
import own from './LivenessStep.module.css';

const PHASES = {
  idle: 'idle',
  capturing: 'capturing',
  analyzing: 'analyzing',
  ok: 'ok',
  livenessFail: 'liveness-fail',
  faceFail: 'face-fail',
};

/**
 * Subscriber self-onboarding (no auth role) → front camera.
 * Agent onboarding a subscriber (auth role: 'agent') → rear camera.
 * Desktop browsers collapse the front/rear distinction to whatever webcam exists.
 */
function pickFacingMode(role) {
  return role === 'agent' ? 'environment' : 'user';
}

/** Longest we'll wait for the first decoded frame before letting the user try anyway. */
const VIDEO_READY_TIMEOUT_MS = 4000;

/**
 * Resolve once `<video>` reports real dimensions — i.e. once it can actually be
 * drawn onto a canvas. `loadedmetadata` is the event that populates
 * videoWidth/videoHeight; attaching a MediaStream to srcObject does not.
 *
 * Resolves (rather than rejects) on timeout: a device that never fires the event
 * shouldn't strand the user on "Starting camera…" forever. captureFrame() still
 * guards on dimensions, so the worst case degrades to the old behaviour instead
 * of a dead end.
 */
function waitForVideoDimensions(video) {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', finish);
      video.removeEventListener('loadeddata', finish);
      resolve();
    };
    const timer = setTimeout(finish, VIDEO_READY_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', finish);
    // Belt-and-braces: some engines populate dimensions on loadeddata instead.
    video.addEventListener('loadeddata', finish);
  });
}

export default function LivenessStep({ onNext, onAgentFallback }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';
  const { role } = useAuth();
  const [phase, setPhase] = useState(PHASES.idle);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const autoAdvanceTimer = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const livenessRetryUsed = signup.livenessRetryUsed;
  const isMirrored = role !== 'agent';

  async function startCamera() {
    // Drop any prior stream first so we don't leak hardware handles.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: pickFacingMode(role) },
          width: { ideal: 720 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Assigning srcObject does NOT mean the element can be drawn from yet:
        // there is a window where the stream is attached but videoWidth /
        // videoHeight are still 0. Reporting ready there enables "Take selfie"
        // and hides the silhouette while captureFrame() would still throw
        // 'Camera not ready' — the user taps, gets "Couldn't capture the frame",
        // and is bounced back to idle for no reason. Wait for real dimensions.
        await waitForVideoDimensions(videoRef.current);
      }
      // The await above yields, so cleanup or a Retake-triggered restart may have
      // stopped/replaced this stream meanwhile. Only the still-current stream gets
      // to announce readiness — otherwise we'd advertise a camera that's been torn
      // down.
      if (streamRef.current !== stream) return;
      setCameraReady(true);
    } catch (err) {
      const message =
        err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'Camera access denied. Allow camera access in your browser to continue.'
          : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError'
          ? 'No camera found on this device.'
          : "Couldn't start the camera. Please check your device and try again.";
      setCameraError(message);
      setCameraReady(false);
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      throw new Error('Camera not ready');
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // Capture the raw camera stream — no mirror transform. CSS-level mirroring
    // is for display only; downstream face-match expects the camera-native
    // orientation (raised right hand appears on the LEFT of the captured image
    // for a front camera, which is the standard photographic convention).
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))),
        'image/jpeg',
        0.85,
      );
    });
  }

  // Start the camera whenever we (re-)enter the idle phase — initial mount,
  // and after the user taps "Retake selfie" on the liveness-fail branch.
  useEffect(() => {
    if (phase !== PHASES.idle) return undefined;
    startCamera();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Final cleanup — stop the stream if the user navigates away mid-step.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Auto-advance once the face match succeeds — give the user ~1.1s to see
  // the checkmark + "All good" status before moving to the next step.
  useEffect(() => {
    if (phase !== PHASES.ok) return undefined;
    autoAdvanceTimer.current = setTimeout(() => onNext(), 1100);
    return () => clearTimeout(autoAdvanceTimer.current);
  }, [phase, onNext]);

  async function startCapture() {
    if (!cameraReady || cameraError) return;
    setPhase(PHASES.capturing);

    let blob;
    try {
      blob = await captureFrame();
    } catch {
      setCameraError("Couldn't capture the frame. Please try again.");
      setPhase(PHASES.idle);
      return;
    }
    signup.patch({ selfieFile: blob });

    // Let the flash animation play before flipping into analyzing.
    await wait(600);
    // Stop the camera now we have the frame — releases the OS "camera in use"
    // indicator and frees the device while the (mocked) face-match runs.
    stopCamera();
    setPhase(PHASES.analyzing);

    try {
      const result = await faceMatch({
        selfieFile: blob,
        nin: signup.nin,
        sessionId: signup.onboardingSessionId,
      });
      if (result.outcome === 'ok') {
        signup.patch({ faceMatchOutcome: 'ok' });
        setPhase(PHASES.ok);
      } else if (result.outcome === 'liveness-fail') {
        signup.patch({ faceMatchOutcome: 'liveness-fail' });
        setPhase(PHASES.livenessFail);
      } else {
        signup.patch({ faceMatchOutcome: 'no-match' });
        setPhase(PHASES.faceFail);
      }
    } catch (e) {
      signup.patch({ faceMatchOutcome: 'no-match' });
      setPhase(PHASES.faceFail);
      void e;
    }
  }

  function retry() {
    signup.patch({ livenessRetryUsed: true, faceMatchOutcome: null });
    setPhase(PHASES.idle);
    // Camera auto-restarts via the useEffect on phase === 'idle'.
  }

  const busy = phase === PHASES.capturing || phase === PHASES.analyzing;
  const canCapture = cameraReady && !cameraError && phase === PHASES.idle;
  // Readiness lamp for the "Face detected" row. There's no live face-tracking
  // signal in the mocked KYC pipeline, so this lights up at the honest moment we
  // actually hold a face frame — once a capture is in flight or has matched.
  const faceDetected =
    phase === PHASES.capturing || phase === PHASES.analyzing || phase === PHASES.ok;

  /* ── Liveness failure: allow one retry, then block → agent ──────────── */
  if (phase === PHASES.livenessFail) {
    if (!livenessRetryUsed) {
      return (
        <div className={styles.card}>
          <motion.div
            className={own.resultIcon}
            data-kind="warn"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
          >
            <svg viewBox="0 0 56 56" width="56" height="56" fill="none" aria-hidden="true">
              <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2.5"/>
              <path d="M28 16v14M28 38v2" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </motion.div>
          <h2 className={`${styles.heading} textCenter`}>Let’s try that again</h2>
          <p className={`${styles.subtext} textCenter`}>
            {isAgent
              ? 'We couldn’t confirm that was a live person. Have them face the camera directly in good lighting — no hats or glasses.'
              : 'We couldn’t confirm that was a live person. Face the camera directly in good lighting — no hats or glasses.'}
          </p>
          <p className={own.retryNotice} role="status">
            {isAgent ? (
              <>You have <strong>1 retry</strong> remaining. If it fails again, complete this verification in person.</>
            ) : (
              <>You have <strong>1 retry</strong> remaining. If it fails again, an agent will help you in person.</>
            )}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.submit} onClick={retry}>
              Retake selfie
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={onAgentFallback}>
              Get help from an agent
            </button>
          </div>
        </div>
      );
    }
    // Already used the one retry → route to agent
    return <TerminalBlock onAgentFallback={onAgentFallback} kind="liveness" />;
  }

  if (phase === PHASES.faceFail) {
    return <TerminalBlock onAgentFallback={onAgentFallback} kind="face" />;
  }

  /* ── Main capture UI ────────────────────────────────────────────────── */
  return (
    <div className={styles.card}>
      <span className={`${styles.eyebrow} ${own.topEyebrow}`}>Step 5 · Selfie</span>
      <h2 className={`${styles.heading} ${own.topHeading}`}>{isAgent ? "Take the subscriber's selfie" : 'Take a quick selfie'}</h2>
      <p className={`${styles.subtext} ${own.topSubtext}`}>
        {isAgent ? (
          'Capture their face to match the ID photo.'
        ) : (
          <>A live-person check matches your face to your NIRA photo. Takes under 30&nbsp;seconds.</>
        )}
      </p>

      <div className={own.frame} data-phase={phase}>
        <div className={own.frameInner}>
          {/* Live camera feed — sits behind the existing overlays. Mirrored
              for front camera (subscriber path) so the user sees themselves
              naturally; not mirrored for the agent rear-camera path. */}
          <video
            ref={videoRef}
            className={own.cameraVideo}
            data-mirror={isMirrored || undefined}
            autoPlay
            playsInline
            muted
          />
          {/* Offscreen canvas — used by captureFrame() to extract the JPEG. */}
          <canvas ref={canvasRef} className={own.cameraCanvas} aria-hidden="true" />

          {/* Silhouette guide — fades out once the live feed is ready. */}
          {!cameraReady && !cameraError && (
            <svg aria-hidden="true" viewBox="0 0 200 200" className={own.silhouette}>
              <circle cx="100" cy="78" r="32" fill="currentColor" opacity="0.35"/>
              <path d="M40 180c0-33 27-54 60-54s60 21 60 54" fill="currentColor" opacity="0.35"/>
            </svg>
          )}
          <div className={own.oval} />

          <AnimatePresence>
            {phase === PHASES.analyzing && (
              <motion.div
                className={own.scanTrack}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.span
                  className={own.scanSweep}
                  initial={{ y: '-40%' }}
                  animate={{ y: ['-40%', '40%', '-40%'] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === PHASES.capturing && (
              <motion.div
                className={own.flash}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.6, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === PHASES.ok && (
              <motion.div
                className={own.checkIcon}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
              >
                <svg viewBox="0 0 56 56" width="56" height="56" fill="none" aria-hidden="true">
                  <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2.5"/>
                  <path d="M17 28l7 7 15-16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Permission / device-error overlay */}
          <AnimatePresence>
            {cameraError && (
              <motion.div
                className={own.permissionOverlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                  <path d="M3 7h4l1.5-2h7L17 7h4a2 2 0 012 2v9a2 2 0 01-2 2H3a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                <p>{cameraError}</p>
                <button
                  type="button"
                  className={own.permissionRetryBtn}
                  onClick={startCamera}
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Idle hint, moved INSIDE the frame per the redesign mockup (.ht).
              Subscriber-only — the agent flow keeps its hint in the status line
              below so the agent viewfinder stays byte-identical. */}
          {!isAgent && phase === PHASES.idle && cameraReady && !cameraError && (
            <div className={own.hint}>Face the camera when you’re ready</div>
          )}
        </div>
        <div className={own.cornerGuides} aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      </div>

      {/* Readiness row between the camera and the button (mockup .livechk).
          Subscriber-only; dots are driven off real camera/capture state. */}
      {!isAgent && (
        <div className={own.livechk} aria-hidden="true">
          <span data-on={cameraReady && !cameraError ? '' : undefined}>Camera ready</span>
          <span data-on={faceDetected ? '' : undefined}>Face detected</span>
        </div>
      )}

      <div className={own.statusLine} aria-live="polite">
        {phase === PHASES.idle && cameraError && ' '}
        {phase === PHASES.idle && !cameraError && !cameraReady && 'Starting camera…'}
        {/* Subscriber moves this hint in-frame (.ht); agent keeps it here. */}
        {phase === PHASES.idle && !cameraError && cameraReady && isAgent && 'Face the camera when you’re ready'}
        {phase === PHASES.capturing && 'Hold steady…'}
        {phase === PHASES.analyzing && 'Checking live-person match…'}
        {phase === PHASES.ok && 'All good — face matched. Taking you to the next step…'}
      </div>

      <div className={`${styles.actions} ${own.actions}`}>
        {phase === PHASES.idle && (
          <>
            <button
              type="button"
              className={styles.submit}
              onClick={startCapture}
              disabled={!canCapture}
            >
              {/* Camera icon kept for the agent console only; the subscriber
                  re-skin uses a clean text pill per the mockup. */}
              {isAgent && (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path d="M5 7h3l2-2h4l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
                  <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.75"/>
                </svg>
              )}
              Take selfie
            </button>
            {/* Proactive help link (mockup .altlink) — routes to the agent
                fallback path the app already surfaces after a failure. */}
            {!isAgent && (
              <div className={own.altlink}>
                <button type="button" className={own.altlinkBtn} onClick={onAgentFallback}>
                  What if my selfie doesn’t match? <span aria-hidden="true">→</span>
                </button>
              </div>
            )}
          </>
        )}

        {busy && (
          <button type="button" className={styles.submit} disabled data-loading>
            <span className={own.btnSpinner} aria-hidden="true" />
            {phase === PHASES.capturing ? 'Capturing…' : 'Checking…'}
          </button>
        )}

        {phase === PHASES.ok && (
          <button type="button" className={styles.submit} disabled data-loading>
            <span className={own.btnSpinner} aria-hidden="true" />
            Continuing…
          </button>
        )}
      </div>
    </div>
  );
}

function TerminalBlock({ onAgentFallback, kind }) {
  const isAgent = useOnboardAudience() === 'agent';
  const copy = kind === 'liveness'
    ? (isAgent
        ? 'We still couldn’t confirm a live person. Verify the subscriber in person.'
        : 'We still couldn’t confirm a live person. An agent can verify you in person.')
    : (isAgent
        ? 'The selfie didn’t match the photo on their ID. Finish this verification in person.'
        : 'Your selfie didn’t match the photo on your ID. An agent will help you finish this in person.');
  return (
    <div className={styles.card}>
      <motion.div
        className={own.resultIcon}
        data-kind="error"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        <svg viewBox="0 0 56 56" width="56" height="56" fill="none" aria-hidden="true">
          <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2.5"/>
          <path d="M19 19l18 18M37 19L19 37" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </motion.div>

      <h2 className={`${styles.heading} textCenter`}>
        {kind === 'liveness' ? 'Verification paused' : 'Selfie didn’t match'}
      </h2>
      <p className={`${styles.subtext} textCenter`}>{copy}</p>

      <div className={styles.actions}>
        <button type="button" className={styles.submit} onClick={onAgentFallback}>
          Get help from an agent
        </button>
      </div>
    </div>
  );
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
