import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import type { Lesson, Level } from '../types'

interface LevelWithLessons extends Level {
  lessons: Lesson[]
}

export default function Curriculum() {
  const [levels, setLevels] = useState<LevelWithLessons[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLevel, setOpenLevel] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('levels')
        .select('*, lessons(*)')
        .order('sort_order')
        .order('lesson_number', { foreignTable: 'lessons', ascending: true })
      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        const lvls = (data ?? []) as unknown as LevelWithLessons[]
        setLevels(lvls)
        if (lvls.length) setOpenLevel(lvls[0].id)
      }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => levels.map((l) => `${l.name}: ${l.lessons.length} lessons`).join(' · '), [levels])

  if (loading) return <LoadingPanel label="Loading curriculum…" />
  if (error) return <ErrorPanel message={error} onRetry={() => window.location.reload()} />

  return (
    <div>
      <PageHeader title="Curriculum" subtitle={summary || undefined} />

      {levels.length === 0 ? (
        <EmptyState title="No curriculum levels found" hint="Add levels and lessons to the database to see them here." />
      ) : (
        <div className="space-y-4">
          {levels.map((level) => {
            const open = openLevel === level.id
            return (
              <div key={level.id} className="card overflow-hidden">
                <button
                  className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                  onClick={() => setOpenLevel(open ? null : level.id)}
                  aria-expanded={open}
                >
                  <div>
                    <h3 className="font-semibold">{level.name}</h3>
                    <div className="text-xs text-slate-500">{level.lessons.length} lessons</div>
                  </div>
                  <span className="text-slate-400" aria-hidden>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="border-t border-slate-100">
                    {level.lessons.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500">No lessons defined for this level yet.</div>
                    ) : (
                      <ol className="divide-y divide-slate-100">
                        {level.lessons.map((lesson) => (
                          <li key={lesson.id} className="p-4 flex gap-4">
                            <div className="w-9 h-9 rounded-full bg-[color:var(--rt-teal)]/10 text-[color:var(--rt-teal)] font-semibold text-sm flex items-center justify-center shrink-0">
                              {lesson.lesson_number}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium">{lesson.title}</div>
                              {lesson.objectives && (
                                <div className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{lesson.objectives}</div>
                              )}
                              {lesson.materials && <div className="text-xs text-slate-500 mt-1">Materials: {lesson.materials}</div>}
                              {lesson.notes && <div className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{lesson.notes}</div>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
