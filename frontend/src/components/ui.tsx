import React from 'react'
import type { AttendanceStatus } from '../types'

/** Coloured status badge for attendance states. */
export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const styles: Record<AttendanceStatus, string> = {
    'Not Arrived': 'bg-slate-100 text-slate-600',
    Arrived: 'bg-emerald-100 text-emerald-800',
    Absent: 'bg-rose-100 text-rose-800',
    Completed: 'bg-teal-100 text-teal-800',
  }
  return (
    <span className={`badge ${styles[status] ?? ''}`}>
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

/** Full-width inline error panel. */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card p-6 text-center border-rose-200 bg-rose-50">
      <div className="text-rose-700 font-medium mb-1">Something went wrong</div>
      <div className="text-sm text-rose-600 mb-3">{message}</div>
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
    <div className="card p-8 text-center text-slate-500">
      <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-[color:var(--rt-teal)] rounded-full animate-spin mb-3" />
      <div className="text-sm">{label}</div>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="font-medium text-slate-700 mb-1">{title}</div>
      {hint && <div className="text-sm text-slate-500">{hint}</div>}
    </div>
  )
}

/** Page header with title, subtitle and optional actions. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
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
  return (
    <div className="card p-4 text-center">
      <div className={`text-3xl font-bold ${toneClass}`}>{value}</div>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
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
    </div>
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
