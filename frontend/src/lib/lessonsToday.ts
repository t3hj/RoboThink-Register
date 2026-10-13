import type { Lesson, Level, StudentProgress, StudentProject } from '../types'
import { parseLevelName } from './curriculum'

export interface LessonsTodayRosterEntry {
  id: string
  full_name: string
  progress: Pick<StudentProgress, 'current_level_id' | 'current_lesson_number' | 'current_lesson_title' | 'level_name'> | null
  /** The lesson derived from actual history. `undefined` means history does
   *  not override the stored pointer; `null` means history is authoritative but
   *  there is no resolvable next lesson. */
  expectedLesson?: Pick<Lesson, 'level_id' | 'lesson_number' | 'title'> | null
  projects?: StudentProject[]
}

export interface LessonGroup {
  levelId: number
  levelName: string
  lessonNumber: number
  lessonTitle: string | null
  students: { id: string; full_name: string }[]
}

export interface ProgrammeGroup {
  programme: string
  groups: LessonGroup[]
}

export interface ProjectGroup {
  projectId: string
  name: string
  students: { id: string; full_name: string }[]
}

/** Groups the selected-date roster by the lesson each student is expected to
 *  do next — the attempt-history-derived `expectedLesson` when supplied,
 *  otherwise the stored current lesson from student_progress — then nests those
 *  groups under their programme in curriculum order (sort_order), lesson
 *  number, then student name. */
export function groupLessonsToday(
  roster: LessonsTodayRosterEntry[],
  levels: Pick<Level, 'id' | 'name' | 'sort_order'>[],
): ProgrammeGroup[] {
  const levelById = new Map(levels.map((l) => [l.id, l]))
  const byKey = new Map<string, LessonGroup>()

  for (const s of roster) {
    const p = s.progress
    const e = s.expectedLesson
    const hasHistoryDerivedLesson = s.expectedLesson !== undefined
    const levelId = hasHistoryDerivedLesson ? e?.level_id ?? null : p?.current_level_id ?? null
    const lessonNumber = hasHistoryDerivedLesson ? e?.lesson_number ?? null : p?.current_lesson_number ?? null
    if (levelId == null || lessonNumber == null) continue
    const lessonTitle = e ? e.title?.trim() || null : p?.current_lesson_title?.trim() || null
    const levelName = e
      ? levelById.get(levelId)?.name ?? p?.level_name ?? ''
      : p?.level_name ?? levelById.get(levelId)?.name ?? ''
    const key = `${levelId}:${lessonNumber}`
    let g = byKey.get(key)
    if (!g) {
      g = {
        levelId,
        levelName,
        lessonNumber,
        lessonTitle,
        students: [],
      }
      byKey.set(key, g)
    }
    g.students.push({ id: s.id, full_name: s.full_name })
  }

  for (const g of byKey.values()) {
    g.students.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }

  const groups = [...byKey.values()].sort((a, b) => {
    const la = levelById.get(a.levelId)?.sort_order ?? 0
    const lb = levelById.get(b.levelId)?.sort_order ?? 0
    if (la !== lb) return la - lb
    return a.lessonNumber - b.lessonNumber
  })

  const order: string[] = []
  const byProgramme = new Map<string, LessonGroup[]>()
  for (const g of groups) {
    const { programme } = parseLevelName(g.levelName)
    if (!byProgramme.has(programme)) {
      byProgramme.set(programme, [])
      order.push(programme)
    }
    byProgramme.get(programme)!.push(g)
  }
  return order.map((programme) => ({ programme, groups: byProgramme.get(programme)! }))
}

/** Active projects are real work for today's register even though they do not advance the curriculum. */
export function groupProjectsToday(roster: LessonsTodayRosterEntry[]): ProjectGroup[] {
  const byProject = new Map<string, ProjectGroup>()
  for (const student of roster) {
    for (const project of student.projects ?? []) {
      if (project.status !== 'active') continue
      const group = byProject.get(project.id) ?? { projectId: project.id, name: project.name, students: [] }
      group.students.push({ id: student.id, full_name: student.full_name })
      byProject.set(project.id, group)
    }
  }
  return [...byProject.values()]
    .map((group) => ({ ...group, students: group.students.sort((a, b) => a.full_name.localeCompare(b.full_name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
