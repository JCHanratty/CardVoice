import React from 'react';

/**
 * CardVoice Logo — a playing card shape with an integrated sound wave / mic motif.
 * Luxury vault aesthetic: burgundy + gold color scheme.
 */
export default function Logo({ size = 40, className = '' }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="cv-card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B2252" />
          <stop offset="100%" stopColor="#D4A847" />
        </linearGradient>
        <linearGradient id="cv-mic-grad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#F0D78C" />
          <stop offset="100%" stopColor="#D4A847" />
        </linearGradient>
        <linearGradient id="cv-wave-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4A847" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#8B2252" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* Card shape — rounded rectangle with gradient stroke */}
      <rect
        x="12" y="4" width="40" height="56" rx="6"
        fill="#18181B"
        stroke="url(#cv-card-grad)"
        strokeWidth="2.5"
      />

      {/* Inner card shine line */}
      <rect
        x="16" y="8" width="32" height="48" rx="3"
        fill="none"
        stroke="url(#cv-card-grad)"
        strokeWidth="0.5"
        opacity="0.2"
      />

      {/* Microphone body */}
      <rect x="28" y="20" width="8" height="14" rx="4" fill="url(#cv-mic-grad)" />

      {/* Mic cradle arc */}
      <path
        d="M25 32 Q25 40 32 40 Q39 40 39 32"
        fill="none"
        stroke="url(#cv-mic-grad)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Mic stand */}
      <line x1="32" y1="40" x2="32" y2="46" stroke="url(#cv-mic-grad)" strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="46" x2="36" y2="46" stroke="url(#cv-mic-grad)" strokeWidth="2" strokeLinecap="round" />

      {/* Sound wave arcs — left side */}
      <path
        d="M20 24 Q16 32 20 40"
        fill="none"
        stroke="url(#cv-wave-grad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M16 21 Q10 32 16 43"
        fill="none"
        stroke="url(#cv-wave-grad)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />

      {/* Sound wave arcs — right side */}
      <path
        d="M44 24 Q48 32 44 40"
        fill="none"
        stroke="url(#cv-wave-grad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M48 21 Q54 32 48 43"
        fill="none"
        stroke="url(#cv-wave-grad)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />

      {/* Corner suit accents — gold diamonds */}
      <path d="M18 12 L20 14 L18 16 L16 14 Z" fill="#D4A847" opacity="0.8" />
      <path d="M46 48 L48 50 L46 52 L44 50 Z" fill="#D4A847" opacity="0.8" />
    </svg>
  );
}
