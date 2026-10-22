import React from 'react'
import type { AttendanceStatus } from '../types'
import { friendlyMessage } from '../lib/errors'
import { RobotIdle } from './RobotArt'
import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'

/** Coloured status badge for attendance states. Colour is never the only
 *  signal — the status word itself is always shown. */
export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const styles: Record<AttendanceStatus, string> = {
    'Not Arrived': 'bg-slate-100 text-slate-600',
    Arrived: 'bg-emerald-100 text-emerald-800',
    Absent: 'bg-rose-100 text-rose-800',
    Completed: 'bg-teal-100 text-teal-800',
  }
  return (
    <span className={`badge badge-dot ${styles[status] ?? ''}`}>
      {status}
    </span>
  )
}

export function SubscriptionBadge({ subscriptionId }: { subscriptionId: number | null }) {
  return (
    <span className={`badge ${subscriptionId === 1 ? 'badge-assess' : ''}`}>
      {subscriptionId === 1 ? 'Elite' : 'Term Time'}
    </span>
  )
}

/** Full-width inline error panel. Never shows the raw database error as the
 *  headline — instructors get a plain-language message; the technical
 *  detail is tucked away for anyone who needs to report it. */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const friendly = friendlyMessage(message)
  return (
    <div className="card p-6 text-center border-rose-200 bg-rose-50" role="alert">
      <div className="text-rose-700 font-medium mb-1">Something went wrong</div>
      <div className="text-sm text-rose-600 mb-3">{friendly}</div>
      {friendly !== message && (
        <details className="text-xs text-rose-400 mb-3">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-1 font-mono">{message}</div>
        </details>
      )}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost">
          Try again
        </button>
      )}
    </div>
  )
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card p-8 text-center text-slate-500" role="status" aria-live="polite">
      <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-[color:var(--rt-primary)] rounded-full animate-spin mb-3" />
      <div className="text-sm">{label}</div>
    </div>
  )
}

export function EmptyState({ title, hint, robot }: { title: string; hint?: string; robot?: boolean }) {
  return (
    <div className="card p-8 text-center">
      {robot && (
        <div className="flex justify-center mb-3">
          <RobotIdle className="w-14 h-14" />
        </div>
      )}
      <div className="font-medium text-slate-700 mb-1">{title}</div>
      {hint && <div className="text-sm text-slate-500">{hint}</div>}
    </div>
  )
}

type BrandAccent = 'yellow' | 'green' | 'red' | 'blue'
const ACCENT_VAR: Record<BrandAccent, string> = {
  yellow: 'var(--rt-yellow)',
  green: 'var(--rt-green)',
  red: 'var(--rt-red)',
  blue: 'var(--rt-blue)',
}

/** Page header with title, subtitle and optional actions. `accent` is a
 *  purely decorative brand-colour touch (see .accent-bar) — it carries no
 *  status meaning. Renders an <h1> — each route is a distinct page and this
 *  is its one main heading. */
export function PageHeader({
  title,
  subtitle,
  actions,
  accent = 'blue',
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  accent?: BrandAccent
}) {
  return (
    <div
      className="accent-bar flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5"
      style={{ '--accent-color': ACCENT_VAR[accent] } as React.CSSProperties}
    >
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

/** Small stat card. */
export function StatCard({ value, label, tone }: { value: React.ReactNode; label: string; tone?: 'good' | 'bad' | 'warn' | undefined }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : ''
  // A thin top accent echoes the tone; neutral cards use the brand blue.
  const accent =
    tone === 'good' ? 'var(--rt-green)' : tone === 'bad' ? 'var(--rt-red)' : tone === 'warn' ? 'var(--rt-yellow)' : 'var(--rt-blue)'
  return (
    <div className="card card-accent-top p-4 text-center" style={{ '--accent-color': accent } as React.CSSProperties}>
      <div className={`text-3xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-sm text-slate-500 mt-1">{label}</div>
    </div>
  )
}

/** Accessible confirm dialog replacing window.confirm. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <ModalOverlay className="flex items-center justify-center bg-black/40 p-4" onClose={onCancel}>
      <div className="card p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="font-semibold mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/** Button with built-in busy state for async actions. */
export function BusyButton({
  busy,
  children,
  className = 'btn-primary',
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className={className} disabled={disabled || busy} {...rest}>
      {busy ? 'Saving…' : children}
    </button>
  )
}


let openOverlays = 0

/** Full-screen dimmed overlay for dialogs. Rendered on document.body so no
 *  page wrapper, transform or overflow can displace it; locks page scrolling
 *  while open and closes on Escape or a click on the backdrop. The dialog
 *  itself should stop click propagation (all existing dialogs do). */
export function ModalOverlay({ className = '', onClose, children }: { className?: string; onClose: () => void; children: React.ReactNode }) {
  // Keep the latest onClose without re-running the effect on every render
  // (callers pass inline arrow functions).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    openOverlays++
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      openOverlays--
      if (openOverlays === 0) document.body.style.overflow = previous
    }
  }, [])

  return createPortal(
    <div className={`fixed inset-0 z-40 ${className}`} onClick={() => closeRef.current()}>
      {children}
    </div>,
    document.body,
  )
}
