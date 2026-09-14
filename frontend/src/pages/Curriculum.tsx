import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import { groupByProgramme, parseLevelName } from '../lib/curriculum'
import type { AssessmentPoint, Lesson, Level } from '../types'

interface LevelWithLessons extends Level {
  lessons: Lesson[]
}

export default function Curriculum() {
  const [levels, setLevels] = useState<LevelWithLessons[]>([])
  const [assessmentPoints, setAssessmentPoints] = useState<AssessmentPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openLevel, setOpenLevel] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const [levelsRes, pointsRes] = await Promise.all([
        supabase
          .from('levels')
          .select('*, lessons(*)')
          .order('sort_order')
          .order('lesson_number', { foreignTable: 'lessons', ascending: true }),
        supabase.from('assessment_points').select('*').eq('active', true),
      ])
      if (cancelled) return
      if (levelsRes.error || pointsRes.error) {
        setError(levelsRes.error?.message ?? pointsRes.error?.message ?? 'Unknown error')
      } else {
        const lvls = (levelsRes.data ?? []) as unknown as LevelWithLessons[]
        setLevels(lvls)
        setAssessmentPoints((pointsRes.data ?? []) as AssessmentPoint[])
        if (lvls.length) setOpenLevel(lvls[0].id)
      }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => groupByProgramme(levels), [levels])
  const assessmentLessonIds = useMemo(() => new Set(assessmentPoints.map((p) => p.after_lesson_id)), [assessmentPoints])
  const totalLessons = useMemo(() => levels.reduce((sum, l) => sum + l.lessons.length, 0), [levels])

  if (loading) return <LoadingPanel label="Loading curriculum…" />
  if (error) return <ErrorPanel message={error} onRetry={() => window.location.reload()} />

  return (
    <div>
      <PageHeader title="Curriculum" subtitle={`${totalLessons} lessons across ${levels.length} terms/levels`} accent="red" />

      {levels.length === 0 ? (
        <EmptyState title="No curriculum levels found" hint="Add levels and lessons to the database to see them here." />
      ) : (
        <div className="space-y-6">
          {groups.map(({ programme, levels: programmeLevels }) => (
            <div key={programme}>
              <h2 className="text-lg font-semibold mb-2">{programme}</h2>
              <div className="space-y-3">
                {programmeLevels.map((level) => {
                  const open = openLevel === level.id
                  const { term } = parseLevelName(level.name)
                  return (
                    <div
                      key={level.id}
                      className={`card overflow-hidden ${open ? 'card-accent-top' : ''}`}
                      style={open ? ({ ['--accent-color' as string]: 'var(--rt-blue)' }) : undefined}
                    >
                      <button
                        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
                        onClick={() => setOpenLevel(open ? null : level.id)}
                        aria-expanded={open}
                      >
                        <div>
                          <h3 className={`font-semibold ${open ? 'text-[color:var(--rt-blue)]' : ''}`}>{term ? `Term ${term}` : level.name}</h3>
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
                                  <div className="w-9 h-9 rounded-full bg-[color:var(--rt-primary)]/10 text-[color:var(--rt-primary)] font-semibold text-sm flex items-center justify-center shrink-0">
                                    {lesson.lesson_number}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium flex items-center gap-2">
                                      {lesson.title}
                                      {assessmentLessonIds.has(lesson.id) && (
                                        <span className="badge badge-assess">Assessment after this lesson</span>
                                      )}
                                    </div>
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
