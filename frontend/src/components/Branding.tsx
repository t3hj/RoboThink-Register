import { useState } from 'react'

export type MascotName = 'Tori' | 'Cha Cha' | 'Jodie' | 'Celly' | 'Roke'

const MASCOTS: { name: MascotName; image: string; tone: string; description: string }[] = [
  { name: 'Tori', image: 'tori', tone: 'var(--rt-blue)', description: 'Imaginative problem-solver' },
  { name: 'Cha Cha', image: 'chacha', tone: 'var(--rt-red)', description: 'Adventurous and bold' },
  { name: 'Jodie', image: 'jodie', tone: 'var(--rt-yellow)', description: 'Kind and reliable' },
  { name: 'Celly', image: 'celly', tone: 'var(--rt-green)', description: 'Brave, determined leader' },
  { name: 'Roke', image: 'roke', tone: 'var(--rt-blue)', description: 'Fast, curious idea-maker' },
]

const mascotByName = Object.fromEntries(MASCOTS.map((mascot) => [mascot.name, mascot])) as Record<MascotName, (typeof MASCOTS)[number]>

/** Official RoboThink character artwork, with a local fallback if the source is unavailable. */
export function MascotPortrait({
  name,
  className = 'w-12 h-12',
  title,
}: {
  name: MascotName
  className?: string
  title?: string
}) {
  const mascot = mascotByName[name]
  const [imageFailed, setImageFailed] = useState(false)
  const imageUrl = `https://robothink.co.uk/wp-content/uploads/2025/08/${mascot.image}.webp`

  return (
    <span className={`inline-flex items-center justify-center shrink-0 overflow-hidden ${className}`}>
      {!imageFailed ? (
        <img
          src={imageUrl}
          alt={title ?? name}
          title={`${name} — ${mascot.description}`}
          className="w-full h-full object-contain"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <svg viewBox="0 0 48 48" role="img" aria-label={title ?? name} className="w-full h-full">
          <circle cx="24" cy="24" r="22" fill="var(--rt-paper)" />
          <path d="M24 3v5" stroke={mascot.tone} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="24" cy="3" r="2.5" fill={mascot.tone} />
          <rect x="10" y="9" width="28" height="25" rx="8" fill={mascot.tone} />
          <rect x="14" y="14" width="20" height="13" rx="5" fill="white" />
          <circle cx="20" cy="20" r="2" fill={mascot.tone} />
          <circle cx="28" cy="20" r="2" fill={mascot.tone} />
          <path d="M19 38h4v5h-4zm6 0h4v5h-4z" fill="var(--rt-ink-soft)" />
        </svg>
      )}
    </span>
  )
}

/** Compact lineup used in the shared app shell so every RoboThink friend is visible. */
export function MascotCrew({ className = '' }: { className?: string }) {
  return (
    <div className={`grid grid-cols-5 gap-1 ${className}`} aria-label="Meet the RoboThink mascots">
      {MASCOTS.map((mascot) => (
        <div key={mascot.name} className="min-w-0 text-center" title={`${mascot.name}: ${mascot.description}`}>
          <MascotPortrait name={mascot.name} className="w-8 h-8 mx-auto" />
          <span className="block truncate text-[9px] leading-tight font-semibold text-slate-500">{mascot.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Official RoboThink wordmark with a clear text fallback. */
export function RoboThinkLogo({ className = 'w-40' }: { className?: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const logoUrl = 'https://assets.cdn.filesafe.space/fsYpcdgWuJOiXoi2pRjz/media/efdc2302-5906-4cb0-858d-4025f8096c78.png'

  return !imageFailed ? (
    <img
      src={logoUrl}
      alt="RoboThink — Build, Code and Play with Robots"
      className={`${className} h-auto object-contain object-left`}
      onError={() => setImageFailed(true)}
    />
  ) : (
    <span className={`inline-flex items-center gap-2 ${className}`} role="img" aria-label="RoboThink">
      <svg viewBox="0 0 38 38" className="w-9 h-9 shrink-0" aria-hidden="true">
        <path d="M19 2v5" stroke="var(--rt-green)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="19" cy="2" r="2" fill="var(--rt-green)" />
        <rect x="5" y="9" width="28" height="20" rx="7" fill="var(--rt-blue)" />
        <rect x="9" y="13" width="20" height="11" rx="4" fill="white" />
        <circle cx="15" cy="18.5" r="1.8" fill="var(--rt-red)" />
        <circle cx="23" cy="18.5" r="1.8" fill="var(--rt-red)" />
        <path d="M11 31h6m4 0h6" stroke="var(--rt-yellow)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="font-extrabold tracking-tight text-slate-700">
        <span className="text-[color:var(--rt-red)]">R</span><span className="text-[color:var(--rt-yellow)]">o</span><span className="text-[color:var(--rt-green)]">b</span><span className="text-[color:var(--rt-blue)]">o</span><span>Think</span>
      </span>
    </span>
  )
}
