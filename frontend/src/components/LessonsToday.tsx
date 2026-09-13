import { Link } from 'react-router-dom'
import type { Level, StudentProgress } from '../types'
import { groupLessonsToday } from '../lib/lessonsToday'

interface RosterLike {
  id: string
  full_name: string
  progress: StudentProgress | null
}

/** Prominent "Lessons to be done today" panel so instructors can pull the
 *  right physical lesson folders before the session starts. All grouping/
 *  sorting logic lives in lib/lessonsToday.ts (unit tested) — this
 *  component is just the rendering. */
export default function LessonsToday({ roster, levels }: { roster: RosterLike[]; levels: Level[] }) {
  const programmes = groupLessonsToday(roster, levels)

  if (programmes.length === 0) return null

  return (
    <section className="card card-accent-top p-4 mb-5" style={{ ['--accent-color' as string]: 'var(--rt-yellow)' }}>
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <span aria-hidden>📁</span> Lessons to be done today
      </h3>
      <p className="text-xs text-slate-500 mb-3">Pull these lesson folders before the session starts.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {programmes.map(({ programme, groups: programmeGroups }) => {
          return (
            <div key={programme}>
              <div className="text-sm font-semibold text-slate-800">{programme}</div>
              {programmeGroups.map((g, i) => {
                const term = /Term (\d+)$/.exec(g.levelName)?.[1] ?? null
                const prevTerm = i > 0 ? /Term (\d+)$/.exec(programmeGroups[i - 1].levelName)?.[1] ?? null : undefined
                const showTermHeader = term != null && term !== prevTerm
                return (
                  <div key={`${g.levelId}-${g.lessonNumber}`} className="mt-1.5">
                    {showTermHeader && <div className="text-xs text-slate-400 mt-1.5 first:mt-0">Term {term}</div>}
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">Lesson {g.lessonNumber}</span>
                      <span className="text-xs text-slate-400">· {g.students.length} student{g.students.length === 1 ? '' : 's'}</span>
                    </div>
                    <ul className="ml-1 text-sm text-slate-600">
                      {g.students.map((st) => (
                        <li key={st.id}>
                          <Link to={`/students/${st.id}`} className="hover:underline">{st.full_name}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
