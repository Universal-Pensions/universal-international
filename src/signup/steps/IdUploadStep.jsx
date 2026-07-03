import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useSignup } from '../SignupContext';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { assessImageQuality } from '../../services/kyc';
import styles from './Step.module.css';
import own from './IdUploadStep.module.css';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const CHECKS = [
  { id: 'blur',    label: 'Sharp focus'      },
  { id: 'corners', label: 'All four corners' },
  { id: 'glare',   label: 'No glare'         },
];

const SIDES = [
  {
    id: 'front',
    label: 'Front',
    description: 'Your photo, name, NIN, and date of birth',
    fileKey: 'idFrontFile',
    urlKey:  'idFrontPreviewUrl',
    qualityKey: 'idFrontQuality',
  },
  {
    id: 'back',
    label: 'Back',
    description: 'The 2D barcode and signature',
    fileKey: 'idBackFile',
    urlKey:  'idBackPreviewUrl',
    qualityKey: 'idBackQuality',
  },
];

export default function IdUploadStep({ onNext }) {
  const signup = useSignup();
  const isAgent = useOnboardAudience() === 'agent';

  // Clean up any stale object URLs when the step unmounts.
  useEffect(() => {
    return () => {
      if (signup.idFrontPreviewUrl) URL.revokeObjectURL(signup.idFrontPreviewUrl);
      if (signup.idBackPreviewUrl)  URL.revokeObjectURL(signup.idBackPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bothUploaded = !!signup.idFrontFile && !!signup.idBackFile;
  const bothPass =
    !!signup.idFrontQuality?.pass && !!signup.idBackQuality?.pass;
  const canContinue = bothUploaded && bothPass;

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Step 1 · National ID</span>
      <h2 className={styles.heading}>
        {isAgent ? "Scan the subscriber's ID" : 'Scan both sides of your Ndaga Muntu'}
      </h2>
      <p className={styles.subtext}>
        {isAgent
          ? 'We’ll read their details from the card — even lighting, whole card in frame, no glare.'
          : 'We read your details from the card so you don’t have to type them.'}
      </p>

      <ul className={own.tips}>
        <TipChip>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
          </svg>
          Good light
        </TipChip>
        <TipChip>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <rect x="2.5" y="4.5" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 8h6M5 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Whole card in frame
        </TipChip>
        <TipChip>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          No glare
        </TipChip>
      </ul>

      <div className={own.sides}>
        {SIDES.map((side) => (
          <SideUploader key={side.id} side={side} />
        ))}
      </div>

      {/* Shared quality checklist — guidance for every tile. Live per-side
          detection still drives each tile's badge + issue message above. */}
      <div className={own.checkrow}>
        {CHECKS.map((check) => (
          <span key={check.id}>{check.label}</span>
        ))}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.submit}
          onClick={onNext}
          disabled={!canContinue}
        >
          {bothUploaded && !bothPass
            ? 'Fix the photos above to continue'
            : 'Continue'}
        </button>
      </div>
    </div>
  );
}

function TipChip({ children }) {
  return <li className={own.tipChip}>{children}</li>;
}

/* ── Per-side uploader ───────────────────────────────────────────────── */

function SideUploader({ side }) {
  const signup = useSignup();
  const file = signup[side.fileKey];
  const url  = signup[side.urlKey];
  const quality = signup[side.qualityKey];

  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  async function handleChange(ev) {
    const selected = ev.target.files?.[0];
    ev.target.value = '';
    if (!selected) return;

    if (!ACCEPTED.includes(selected.type) && !/\.(jpe?g|png|webp|heic)$/i.test(selected.name)) {
      setError('Upload a JPG, PNG, WEBP, or HEIC image.');
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setError('Image is larger than 10 MB. Try a smaller photo.');
      return;
    }

    if (url) URL.revokeObjectURL(url);
    const nextUrl = URL.createObjectURL(selected);

    signup.patch({
      [side.fileKey]: selected,
      [side.urlKey]: nextUrl,
      [side.qualityKey]: null,
    });
    setError('');
    setAnalyzing(true);

    const report = await assessImageQuality(selected);
    signup.patch({ [side.qualityKey]: report });
    setAnalyzing(false);
  }

  function clearSide() {
    if (url) URL.revokeObjectURL(url);
    signup.patch({
      [side.fileKey]: null,
      [side.urlKey]: null,
      [side.qualityKey]: null,
    });
    setError('');
  }

  const state = !file ? 'empty' : analyzing ? 'analyzing' : quality?.pass ? 'ok' : 'issue';
  const inputId = `id-upload-${side.id}`;

  return (
    <div className={own.sideCell}>
      {/* Label wraps the input AS A DIRECT CHILD — the textbook HTML5 pattern:
          clicks anywhere in the tile forward to the nested input. The input is
          also absolutely positioned over the whole tile (double-guarantee). */}
      <label className={own.drop} data-state={state}>
        <input
          id={inputId}
          name={inputId}
          type="file"
          accept="image/*"
          className={own.fileOverlay}
          onChange={handleChange}
          aria-label={`Upload ${side.label.toLowerCase()} of your ID`}
          // Suppress the native "No file chosen" browser tooltip.
          title=""
        />

        <SideBadge state={state} />

        <span className={own.ui} aria-hidden="true">
          {state === 'ok' ? (
            <svg viewBox="0 0 24 24">
              <path d="M4 12l5 5L20 6"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M12 16V4M7 9l5-5 5 5"/>
              <path d="M5 20h14"/>
            </svg>
          )}
        </span>

        <span className={own.lab}>{side.label}</span>
        <span className={own.sub}>
          {side.description}{state === 'empty' ? ' · Tap to upload' : ''}
        </span>

        {analyzing && (
          <span className={own.scanTrack} aria-hidden="true">
            <motion.span
              className={own.scanSweep}
              initial={{ y: '-50%' }}
              animate={{ y: ['-50%', '50%', '-50%'] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </span>
        )}
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {/* Quality failure guidance */}
      {!analyzing && file && quality && !quality.pass && (
        <div className={own.issueBox}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.75"/>
            <path d="M10 6v5M10 14h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
          <span>{qualityMessage(quality, side.label)}</span>
        </div>
      )}

      {file && (
        <button type="button" className={own.retake} onClick={clearSide}>
          {quality?.pass ? 'Replace photo' : 'Retake photo'}
        </button>
      )}
    </div>
  );
}

function qualityMessage(quality, sideLabel) {
  const problems = [];
  if (!quality.blur) problems.push('photo is blurry');
  if (!quality.corners) problems.push('a corner is cut off');
  if (!quality.glare) problems.push('glare is covering the card');
  if (problems.length === 0) return `Retake the ${sideLabel.toLowerCase()} photo.`;
  return `Retake the ${sideLabel.toLowerCase()} — ${problems.join(' and ')}.`;
}

/* ── Status badge ────────────────────────────────────────────────────── */

function SideBadge({ state }) {
  if (state === 'ok') {
    return <span className={own.badge}>Looks good</span>;
  }
  if (state === 'issue') {
    return <span className={own.badge}>Needs a retake</span>;
  }
  if (state === 'analyzing') {
    return (
      <span className={own.badge}>
        <span className={own.badgeSpinner} aria-hidden="true" />
        Checking
      </span>
    );
  }
  return <span className={own.badge}>Required</span>;
}
