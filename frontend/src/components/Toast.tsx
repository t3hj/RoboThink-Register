import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  notify: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue>({ notify: () => { } })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((items) => items.filter((item) => item.id !== id))
  }, [])
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId++
    setToasts((t) => [...t, { id, kind, message }])
    if (kind !== 'error') timers.current.set(id, setTimeout(() => dismiss(id), 4500))
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-auto max-h-[50dvh] overflow-y-auto" aria-label="Notifications">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium border ${t.kind === 'success'
                ? 'bg-emerald-600 text-white border-emerald-700'
                : t.kind === 'error'
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-slate-800 text-white border-slate-900'
              }`}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1 min-w-0 break-words">{t.message}</span>
              <button type="button" className="shrink-0 rounded px-1 text-white hover:bg-white/15" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>×</button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
