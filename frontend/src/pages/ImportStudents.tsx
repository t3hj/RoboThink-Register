import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readSheet } from 'read-excel-file/browser'
import { supabase } from '../lib/supabaseClient'
import { useBrand } from '../lib/brand'
import { useCentres } from '../lib/centres'
import { useToast } from '../components/Toast'
import { PageHeader, BusyButton, EmptyState } from '../components/ui'
import { DAYS } from '../components/SessionSlotsEditor'
import { dayName, todayISO } from '../lib/dates'
import {
  contactFor,
  parsePebbleSheet,
  planImport,
  suggestSubscriptionId,
  type ExistingStudent,
  type PebbleParseResult,
  type PlanAction,
} from '../lib/pebbleImport'
import type { Subscription } from '../types'

const ACTION_LABEL: Record<PlanAction, string> = {
  create: 'New student',
  add_session: 'Add session',
  unchanged: 'Already up to date',
  duplicate_in_file: 'Listed twice',
  needs_attention: 'Needs a look',
}
const ACTION_STYLE: Record<PlanAction, string> = {
  create: 'badge-arrived',
  add_session: 'badge-assess',
  unchanged: '',
  duplicate_in_file: 'badge-absent',
  needs_attention: 'badge-absent',
}
const NO_TICKET = '(no ticket)'
const chunk = <T,>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/** Admins and managers: bring a venue's students in from a Pebble register
 *  download. The file is read in the browser and never uploaded; only name,
 *  date of birth, mobile, email and ticket type are used. */
export default function ImportStudents() {
  const { activeBrand } = useBrand()
  const { activeCentres, selectedCentreId } = useCentres()
  const { notify } = useToast()

  const [centreId, setCentreId] = useState(selectedCentreId ?? '')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [parsed, setParsed] = useState<PebbleParseResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [ticketMap, setTicketMap] = useState<Record<string, number | ''>>({})
  const [existing, setExisting] = useState<ExistingStudent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)

  useEffect(() => {
    void supabase.from('subscriptions').select('*').order('id').then(({ data }) => setSubscriptions((data ?? []) as Subscription[]))
  }, [])

  useEffect(() => {
    if (!centreId && selectedCentreId) setCentreId(selectedCentreId)
  }, [centreId, selectedCentreId])

  // Load the centre's current students so we can match rather than duplicate.
  useEffect(() => {
    if (!centreId || !parsed) return
    let cancelled = false
    setExisting(null)
    void supabase
      .from('students')
      .select('id,full_name,date_of_birth,parent_contact,active,attendance_pattern,student_schedules(day_of_week,start_time,active)')
      .eq('centre_id', centreId)
      .limit(2000)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) return notify(error.message, 'error')
        setExisting(
          (data ?? []).map((s) => ({
            id: s.id as string,
            full_name: s.full_name as string,
            date_of_birth: (s.date_of_birth as string | null) ?? null,
            parent_contact: (s.parent_contact as string | null) ?? null,
            active: Boolean(s.active),
            attendance_pattern: s.attendance_pattern as string | null,
            slots: ((s.student_schedules as { day_of_week: string; start_time: string; active: boolean }[] | null) ?? [])
              .filter((r) => r.active)
              .map((r) => ({ day: r.day_of_week, time: r.start_time })),
          })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [centreId, parsed, notify])

  async function onFile(file: File | undefined) {
    setResult(null)
    if (!file) return
    setFileName(file.name)
    try {
      const cells = (await readSheet(file)) as unknown[][]
      const p = parsePebbleSheet(cells)
      setParsed(p)
      setDay(p.meta.date ? dayName(p.meta.date) : '')
      setTime(p.meta.time ?? '')
      const tickets = [...new Set(p.rows.map((r) => r.ticket ?? NO_TICKET))]
      setTicketMap(Object.fromEntries(tickets.map((t) => [t, suggestSubscriptionId(t === NO_TICKET ? null : t, subscriptions) ?? ''])))
    } catch {
      setParsed(null)
      notify('That file could not be read. Please upload the .xlsx register downloaded from Pebble.', 'error')
    }
  }

  const slot = day ? { day, time: time || null } : null
  const plans = useMemo(() => (parsed && existing ? planImport(parsed.rows, existing, slot) : []), [parsed, existing, slot?.day, slot?.time]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c: Record<PlanAction, number> = { create: 0, add_session: 0, unchanged: 0, duplicate_in_file: 0, needs_attention: 0 }
    plans.forEach((p) => c[p.action]++)
    return c
  }, [plans])
  const fills = plans.filter((p) => p.fillDob || p.fillContact).length

  const creates = plans.filter((p) => p.action === 'create')
  const tickets = Object.keys(ticketMap)
  const unmapped = creates.some((p) => ticketMap[p.row.ticket ?? NO_TICKET] === '')
  const nothingToDo = counts.create + counts.add_session + fills === 0
  const canImport = Boolean(parsed && existing && centreId && !unmapped && !nothingToDo && !busy)

  async function run() {
    if (!parsed || !existing) return
    setBusy(true)
    const log: string[] = []
    try {
      const newRows = creates.map((p) => ({
        id: crypto.randomUUID(),
        full_name: p.row.name,
        brand: activeBrand,
        centre_id: centreId,
        date_joined: todayISO(),
        subscription_id: ticketMap[p.row.ticket ?? NO_TICKET] === '' ? null : ticketMap[p.row.ticket ?? NO_TICKET],
        preferred_day: slot?.day ?? null,
        preferred_time: slot?.time ?? null,
        date_of_birth: p.row.dob,
        parent_contact: contactFor(p.row),
        active: true,
      }))
      for (const part of chunk(newRows, 50)) {
        const { error } = await supabase.from('students').insert(part)
        if (error) throw new Error(`Adding students failed: ${error.message}`)
      }
      log.push(`${newRows.length} new student${newRows.length === 1 ? '' : 's'} added`)

      if (slot?.time) {
        const slotRows = [
          ...newRows.map((r) => ({ student_id: r.id, pattern: 'EVERY_WEEK' })),
          ...plans.filter((p) => p.action === 'add_session' && p.existing).map((p) => ({ student_id: p.existing!.id, pattern: p.existing!.attendance_pattern === 'fortnightly' ? 'A' : 'EVERY_WEEK' })),
        ].map((r) => ({ student_id: r.student_id, day_of_week: slot.day, start_time: slot.time, week_pattern: r.pattern, active: true }))
        for (const part of chunk(slotRows, 100)) {
          const { error } = await supabase.from('student_schedules').insert(part)
          if (error) throw new Error(`Saving sessions failed: ${error.message}. The students were added; set their sessions by editing them.`)
        }
        log.push(`${counts.add_session} extra session${counts.add_session === 1 ? '' : 's'} added to existing students`)
      } else if (counts.add_session > 0) {
        log.push('No session time in the file, so no sessions were added to existing students')
      }

      let filled = 0
      for (const p of plans.filter((x) => x.existing && (x.fillDob || x.fillContact))) {
        const patch: Record<string, string | null> = {}
        if (p.fillDob) patch.date_of_birth = p.row.dob
        if (p.fillContact) patch.parent_contact = contactFor(p.row)
        const { error } = await supabase.from('students').update(patch).eq('id', p.existing!.id)
        if (error) throw new Error(`Updating details failed: ${error.message}`)
        filled++
      }
      if (filled) log.push(`Missing details filled in for ${filled} existing student${filled === 1 ? '' : 's'}`)
      setResult(log)
      setParsed(null)
      setFileName('')
      notify('Import finished', 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Import failed', 'error')
      log.push(e instanceof Error ? e.message : 'Import failed')
      setResult(log)
    }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader title="Import students from Pebble" subtitle="Upload a register download to add a venue's students in one go" accent="green" />

      {result && (
        <section className="card p-4 mb-5" role="status">
          <h2 className="font-semibold mb-2">Result</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">{result.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="text-sm mt-3">
            Imported students have no lesson yet. An instructor sets it from each student’s page, or use{' '}
            <Link className="text-[color:var(--rt-primary)] font-medium hover:underline" to="/students?filter=needs-lesson">Students needing a starting lesson</Link>.
          </p>
        </section>
      )}

      <section className="card p-4 mb-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm block">
            <span className="block text-slate-500 mb-1">1. Which venue is this register for?</span>
            <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={centreId} onChange={(e) => setCentreId(e.target.value)} disabled={busy}>
              <option value="">— Choose a centre —</option>
              {activeCentres.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            <span className="block text-slate-500 mb-1">2. Pebble register (.xlsx)</span>
            <input type="file" accept=".xlsx" className="w-full text-sm" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy || !centreId} />
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          The file is read in your browser and is not uploaded. Only the child’s name, date of birth, mobile, email and
          ticket type are used. Medical, SEN, photo permission, year group, marketing opt-in and everything else in the
          file is ignored.
        </p>
      </section>

      {parsed?.error && <div className="card p-4 mb-5 text-sm text-rose-700" role="alert">{parsed.error}</div>}

      {parsed && !parsed.error && (
        <>
          <section className="card p-4 mb-5">
            <h2 className="font-semibold mb-1">3. Check the session</h2>
            <p className="text-xs text-slate-500 mb-3">
              {fileName}{parsed.meta.activity ? ` · ${parsed.meta.activity}` : ''}. Each student gets this weekly session. Correct it if the file is wrong.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <label className="text-sm block">
                <span className="block text-slate-500 mb-1">Day</span>
                <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy}>
                  <option value="">None</option>
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="text-sm block">
                <span className="block text-slate-500 mb-1">Start time</span>
                <input type="time" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
              </label>
            </div>
            {!slot?.time && <p className="text-xs text-amber-700 mt-2">Without a day and time, students are added but won’t appear on any register until you set their sessions.</p>}
            {parsed.ignoredColumns.length > 0 && (
              <p className="text-xs text-slate-500 mt-3">Not imported: {parsed.ignoredColumns.join(', ')}.</p>
            )}
          </section>

          {creates.length > 0 && (
            <section className="card p-4 mb-5">
              <h2 className="font-semibold mb-1">4. Match tickets to subscriptions</h2>
              <p className="text-xs text-slate-500 mb-3">Only needed for new students.</p>
              <div className="space-y-2">
                {tickets.map((t) => (
                  <label key={t} className="text-sm grid sm:grid-cols-2 gap-2 items-center">
                    <span>{t}</span>
                    <select className="p-2 border border-slate-200 rounded-lg text-sm" value={ticketMap[t]} onChange={(e) => setTicketMap((m) => ({ ...m, [t]: e.target.value === '' ? '' : Number(e.target.value) }))} disabled={busy}>
                      <option value="">— Choose —</option>
                      {subscriptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="card p-4 mb-5">
            <h2 className="font-semibold mb-3">Preview</h2>
            {!existing ? (
              <div className="text-sm text-slate-400">Checking existing students…</div>
            ) : plans.length === 0 ? (
              <EmptyState title="No students found" />
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3 text-sm">
                  {(Object.keys(counts) as PlanAction[]).filter((k) => counts[k] > 0).map((k) => (
                    <span key={k} className={`badge ${ACTION_STYLE[k]}`}>{counts[k]} {ACTION_LABEL[k].toLowerCase()}</span>
                  ))}
                  {fills > 0 && <span className="badge">{fills} with missing details to fill in</span>}
                </div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {plans.map((p) => (
                    <li key={p.row.rowNumber} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium">{p.row.name}</span>
                        <span className="text-xs text-slate-500"> · {p.row.ticket ?? 'no ticket'}</span>
                        {(p.reason || p.row.warnings.length > 0) && (
                          <div className="text-xs text-amber-700">{[p.reason, ...p.row.warnings].filter(Boolean).join(' · ')}</div>
                        )}
                      </div>
                      <span className={`badge badge-dot ${ACTION_STYLE[p.action]}`}>{ACTION_LABEL[p.action]}</span>
                    </li>
                  ))}
                </ul>
                {unmapped && <p className="text-xs text-amber-700 mt-3">Choose a subscription for every ticket above before importing.</p>}
                <div className="mt-4">
                  <BusyButton busy={busy} onClick={() => void run()} disabled={!canImport}>
                    Import {counts.create} new · {counts.add_session} session{counts.add_session === 1 ? '' : 's'}
                  </BusyButton>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
