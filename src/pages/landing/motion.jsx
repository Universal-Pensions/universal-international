/**
 * Landing-page motion primitive.
 *
 * `<Reveal>` gives the marketing sections the same scroll-in choreography as the
 * live production landing — a travel + fade with an optional scale-pop, on the
 * shared project easing curve (`EASE_OUT_EXPO`) — replacing the old CSS
 * `.reveal` + IntersectionObserver approach. It honours `useReducedMotion()`:
 * when the user prefers reduced motion it renders a plain element with no
 * animation.
 *
 * Note: this is for below-the-fold content that scrolls into view. The hero
 * (above the fold, in view on load) uses a pure-CSS entrance instead — see
 * `.heroReveal` in landing.module.css — because `whileInView` does not fire for
 * elements already in view at mount, and Framer's mount-`animate` is unreliable
 * under React StrictMode's dev double-render.
 *
 * Shared by SubscribersPage / EmployersPage / DistributorsPage.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

export const EASE = EASE_OUT_EXPO;

// Reveal an element with a travel + fade (+ optional scale-pop) as it scrolls in.
export function Reveal({
  as = 'div', y = 24, scale, delay = 0, duration = 0.7, className, children, ...rest
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    const Tag = as;
    return <Tag className={className} {...rest}>{children}</Tag>;
  }
  const MotionTag = motion[as] || motion.div;
  const hidden = { opacity: 0, y, ...(scale != null ? { scale } : null) };
  const shown = { opacity: 1, y: 0, ...(scale != null ? { scale: 1 } : null) };
  return (
    <MotionTag
      className={className}
      initial={hidden}
      whileInView={shown}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
