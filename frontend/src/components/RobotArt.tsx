/** Small, original RoboThink-styled robot illustrations, used sparingly
 *  (empty states, a couple of header/dashboard accents). Deliberately
 *  simple geometric shapes in the brand palette — not a reproduction of
 *  any existing character artwork (site or Figma), just in the same
 *  friendly-robot spirit. Inline SVG: no network requests, no bundle-size
 *  or load-time cost worth worrying about. */

type RobotProps = { className?: string; title?: string }

/** A cheerful little robot with an antenna — used for empty/blank states
 *  ("nothing here yet") so they feel a bit less bare without being noisy. */
export function RobotIdle({ className = 'w-16 h-16', title }: RobotProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title ?? 'Robot mascot'}>
      <circle cx="32" cy="6" r="3" fill="var(--rt-yellow)" />
      <rect x="30.5" y="8" width="3" height="8" rx="1.5" fill="#cbd5e1" />
      <rect x="14" y="16" width="36" height="30" rx="10" fill="var(--rt-blue)" />
      <rect x="19" y="21" width="26" height="18" rx="7" fill="#fff" />
      <circle cx="27" cy="30" r="3.2" fill="var(--rt-blue)" />
      <circle cx="37" cy="30" r="3.2" fill="var(--rt-blue)" />
      <rect x="22" y="50" width="8" height="8" rx="2" fill="var(--rt-green)" />
      <rect x="34" y="50" width="8" height="8" rx="2" fill="var(--rt-green)" />
      <rect x="6" y="24" width="6" height="12" rx="3" fill="var(--rt-yellow)" />
      <rect x="52" y="24" width="6" height="12" rx="3" fill="var(--rt-yellow)" />
    </svg>
  )
}

/** A waving robot — small header/dashboard accent, not an empty-state. */
export function RobotWave({ className = 'w-16 h-16', title }: RobotProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title ?? 'Waving robot mascot'}>
      <circle cx="30" cy="6" r="3" fill="var(--rt-red)" />
      <rect x="28.5" y="8" width="3" height="8" rx="1.5" fill="#cbd5e1" />
      <rect x="12" y="16" width="36" height="30" rx="10" fill="var(--rt-green)" />
      <rect x="17" y="21" width="26" height="18" rx="7" fill="#fff" />
      <circle cx="25" cy="30" r="3.2" fill="var(--rt-green)" />
      <circle cx="35" cy="30" r="3.2" fill="var(--rt-green)" />
      <path d="M25 35 q5 4 10 0" stroke="var(--rt-green)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="20" y="50" width="8" height="8" rx="2" fill="var(--rt-blue)" />
      <rect x="32" y="50" width="8" height="8" rx="2" fill="var(--rt-blue)" />
      <rect x="4" y="22" width="6" height="12" rx="3" fill="var(--rt-yellow)" />
      {/* raised, waving arm */}
      <rect x="46" y="6" width="6" height="16" rx="3" fill="var(--rt-yellow)" transform="rotate(20 49 14)" />
    </svg>
  )
}

/** A small badge-style robot face — used next to reminders/notices where a
 *  full illustration would be too much. */
export function RobotBadge({ className = 'w-8 h-8', title }: RobotProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={title ?? 'Robot'}>
      <rect x="4" y="6" width="24" height="20" rx="7" fill="var(--rt-yellow)" />
      <rect x="8" y="11" width="16" height="11" rx="4.5" fill="#fff" />
      <circle cx="13" cy="16.5" r="2" fill="var(--rt-yellow)" />
      <circle cx="19" cy="16.5" r="2" fill="var(--rt-yellow)" />
      <circle cx="16" cy="3" r="2" fill="var(--rt-red)" />
    </svg>
  )
}
