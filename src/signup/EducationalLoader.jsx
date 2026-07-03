import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../utils/motion';

import styles from './EducationalLoader.module.css';

// Rotating pension-benefit messages shown during KYC wait states (NIRA, AML).
// Each message is a small narrative beat — a benefit a Ugandan saver gets from
// enrolling. Icons and stats are illustrative, not institutional numbers.
const BENEFITS = [
  {
    id: 'compound',
    eyebrow: 'Did you know',
    headline: (
      <>
        UGX&nbsp;50,000/month grows to UGX&nbsp;13M by age&nbsp;60.
      </>
    ),
    icon: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" width="28" height="28">
        <path d="M6 30 L14 22 L22 26 L34 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="34" cy="10" r="2.5" fill="currentColor"/>
        <path d="M6 34h28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
      </svg>
    ),
  },
  {
    id: 'tax',
    eyebrow: 'Safe & regulated',
    headline: (
      <>
        Licensed by <span translate="no">URBRA</span>. Your savings are ring-fenced.
      </>
    ),
    icon: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" width="28" height="28">
        <path d="M20 4l14 6v10c0 8-6 15-14 17-8-2-14-9-14-17V10l14-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
        <path d="M14 20l5 5 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'flexible',
    eyebrow: 'Your pace',
    headline: 'Save any amount, any time. No minimum.',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" width="28" height="28">
        <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="2"/>
        <path d="M20 12v8l5 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'family',
    eyebrow: 'Protected',
    headline: 'Your family inherits without probate delays.',
    icon: (
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" width="28" height="28">
        <circle cx="15" cy="14" r="5" stroke="currentColor" strokeWidth="2"/>
        <circle cx="27" cy="16" r="4" stroke="currentColor" strokeWidth="2"/>
        <path d="M6 33c1-5 5-8 9-8s8 3 9 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M22 32c1-4 4-7 8-7s6 3 7 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
      </svg>
    ),
  },
];

// Long enough to read a short line comfortably without feeling stuck.
const ROTATE_MS = 3500;

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function EducationalLoader() {
  const [index, setIndex] = useState(0);

  // Pause auto-rotation when the user prefers reduced motion — a single static
  // benefit is calmer than auto-advancing content.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % BENEFITS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const current = BENEFITS[index];

  // Compact horizontal card: a small icon tile on the left + an eyebrow/headline
  // text column on the right, with a dot pager below. Mirrors the redesign
  // mockup's `.educard` / `.edudots`.
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            className={styles.row}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
          >
            <div className={styles.iconTile} aria-hidden="true">
              {current.icon}
            </div>
            <div className={styles.text}>
              <span className={styles.eyebrow}>{current.eyebrow}</span>
              <h3 className={styles.headline}>{current.headline}</h3>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className={styles.dots} aria-hidden="true">
        {BENEFITS.map((b, i) => (
          <span
            key={b.id}
            className={styles.dot}
            data-active={i === index || undefined}
          />
        ))}
      </div>
    </div>
  );
}
