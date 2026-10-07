import { useState } from 'react'
import { formatDisplayDate } from '../lib/dates'
import { supabase } from '../lib/supabaseClient'
import type { StudentProject, StudentProjectStatus } from '../types'

const statuses: { value: StudentProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

type FormValues = {
  name: string
  description: string
  startDate: string
  targetEndDate: string
  completedDate: string
  status: StudentProjectStatus
}

function emptyForm(): FormValues {
  return {
    name: '',
    description: '',
    startDate: new Date().toISOString().slice(0, 10),
    targetEndDate: '',
    completedDate: '',
    status: 'active',
  }
}

function formFrom(project: StudentProject): FormValues {
  return {
    name: project.name,
    description: project.description ?? '',
    startDate: project.start_date,
    targetEndDate: project.target_end_date ?? '',
    completedDate: project.completed_date ?? '',
    status: project.status,
  }
}

function durationLabel(days: number | null) {
  if (days == null) return 'Duration paused'
  return `${days} day${days === 1 ? '' : 's'}`
}

export default function StudentProjectsPanel({
  studentId,
  projects,
  onChanged,
}: {
  studentId: string
  projects: StudentProject[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<StudentProject | 'new' | null>(null)
  const [values, setValues] = useState<FormValues>(emptyForm())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openNew() {
    setValues(emptyForm())
    setError(null)
    setEditing('new')
  }

  function openEdit(project: StudentProject) {
    setValues(formFrom(project))
    setError(null)
    setEditing(project)
  }

  function close() {
    if (!busy) setEditing(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!values.name.trim() || !values.startDate) return
    if (values.status === 'completed' && !values.completedDate) {
      setError('Add the completion date before marking this project completed.')
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      start_date: values.startDate,
      target_end_date: values.targetEndDate || null,
      completed_date: values.completedDate || null,
      status: values.status,
    }
    const result = editing === 'new'
      ? await supabase.from('student_projects').insert({ ...payload, student_id: studentId })
      : await supabase.from('student_projects').update(payload).eq('id', editing?.id ?? '')
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setEditing(null)
    onChanged()
  }

  return (
    <section className="card p-4 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">Projects</h3>
          <p className="text-xs text-slate-500">Track independent work alongside this student’s lessons.</p>
        </div>
        <button className="btn-ghost text-sm" onClick={openNew}>Add project</button>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-slate-500">No projects recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {projects.map((project) => (
            <li key={project.id} className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{project.name}</span>
                  <span className="badge">{statuses.find((status) => status.value === project.status)?.label ?? project.status}</span>
                </div>
                {project.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{project.description}</p>}
                <p className="text-xs text-slate-500 mt-1">
                  Started {formatDisplayDate(project.start_date)}
                  {project.target_end_date ? ` · Target ${formatDisplayDate(project.target_end_date)}` : ''}
                  {project.completed_date ? ` · Completed ${formatDisplayDate(project.completed_date)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-medium">{durationLabel(project.duration_days)}</span>
                <button className="text-sm text-[color:var(--rt-primary)] hover:underline" onClick={() => openEdit(project)}>Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <form className="mt-4 pt-4 border-t border-slate-100 space-y-3" onSubmit={(event) => void save(event)}>
          <h4 className="font-medium">{editing === 'new' ? 'Add project' : 'Edit project'}</h4>
          <label className="block text-sm">
            <span className="block text-slate-500 mb-1">Project name</span>
            <input className="w-full p-2 border border-slate-200 rounded-lg" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required />
          </label>
          <label className="block text-sm">
            <span className="block text-slate-500 mb-1">Description</span>
            <textarea className="w-full p-2 border border-slate-200 rounded-lg" rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block text-slate-500 mb-1">Start date</span>
              <input type="date" className="w-full p-2 border border-slate-200 rounded-lg" value={values.startDate} onChange={(event) => setValues({ ...values, startDate: event.target.value })} required />
            </label>
            <label className="block text-sm">
              <span className="block text-slate-500 mb-1">Target end date</span>
              <input type="date" className="w-full p-2 border border-slate-200 rounded-lg" value={values.targetEndDate} onChange={(event) => setValues({ ...values, targetEndDate: event.target.value })} min={values.startDate} />
            </label>
            <label className="block text-sm">
              <span className="block text-slate-500 mb-1">Status</span>
              <select className="w-full p-2 border border-slate-200 rounded-lg" value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as StudentProjectStatus })}>
                {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-slate-500 mb-1">Completion date</span>
              <input type="date" className="w-full p-2 border border-slate-200 rounded-lg" value={values.completedDate} onChange={(event) => setValues({ ...values, completedDate: event.target.value })} min={values.startDate} />
            </label>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close} disabled={busy}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save project'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
