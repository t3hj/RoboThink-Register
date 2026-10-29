import type { CSSProperties, ReactNode } from 'react'

/** Native disclosure keeps its children mounted, including any unfinished
 *  controls, while its summary and outstanding count remain visible. */
export default function CollapsiblePanel({ title, countLabel, accent = 'blue', children }: {
  title: string
  countLabel: string
  accent?: 'blue' | 'yellow' | 'red'
  children: ReactNode
}) {
  return (
    <details className="group card card-accent-top mb-3" style={{ '--accent-color': `var(--rt-${accent})` } as CSSProperties} aria-label={title}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-sm font-semibold">{title}</span>
        <span className={`badge ${accent === 'red' ? 'badge-assess' : ''}`}>{countLabel}</span>
        <span className="text-slate-600 group-open:rotate-180" aria-hidden>⌄</span>
      </summary>
      <div className="border-t border-slate-100 p-3 sm:p-4">{children}</div>
    </details>
  )
}
