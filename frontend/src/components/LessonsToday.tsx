import CollapsiblePanel from './CollapsiblePanel'
import { Link } from 'react-router-dom'
import type { Lesson, Level, StudentProgress } from '../types'
import { groupLessonsToday, groupProjectsToday } from '../lib/lessonsToday'

interface RosterLike {
  id: string
  full_name: string
  progress: StudentProgress | null
  /** History-derived lesson for the student's next session; preferred over
   *  progress.current_lesson_number when present. */
  expectedLesson?: Pick<Lesson, 'level_id' | 'lesson_number' | 'title'> | null
}

/** Prominent "Lessons to be done today" panel so instructors can pull the
 *  right physical lesson folders before the session starts. All grouping/
 *  sorting logic lives in lib/lessonsToday.ts (unit tested) — this
 *  component is just the rendering. */
export default function LessonsToday({ roster, levels }: { roster: RosterLike[]; levels: Level[] }) {
  const programmes = groupLessonsToday(roster, levels)
  const projects = groupProjectsToday(roster)

  if (programmes.length === 0 && projects.length === 0) return null

  return (
    <CollapsiblePanel title="Lessons to be done today" countLabel={`${programmes.reduce((count, programme) => count + programme.groups.length, 0)} folders${projects.length ? ` · ${projects.length} projects` : ''}`} accent="yellow">
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
                      <span className="text-sm font-medium">
                        Lesson {g.lessonNumber}{g.lessonTitle ? ` — ${g.lessonTitle}` : ''}
                      </span>
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
      {projects.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="text-sm font-semibold text-slate-800">Projects</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {projects.map((project) => (
              <div key={project.projectId} className="mt-1">
                <div className="text-sm font-medium">{project.name}</div>
                <ul className="ml-1 text-sm text-slate-600">
                  {project.students.map((student) => (
                    <li key={student.id}><Link to={`/students/${student.id}`} className="hover:underline">{student.full_name}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsiblePanel>
  )
}
