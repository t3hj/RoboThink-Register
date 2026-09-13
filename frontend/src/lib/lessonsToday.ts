import type { Level, StudentProgress } from '../types'
import { parseLevelName } from './curriculum'

export interface LessonsTodayRosterEntry {
  id: string
  full_name: string
  progress: Pick<StudentProgress, 'current_level_id' | 'current_lesson_number' | 'level_name'> | null
}

export interface LessonGroup {
  levelId: number
  levelName: string
  lessonNumber: number
  students: { id: string; full_name: string }[]
}

export interface ProgrammeGroup {
  programme: string
  groups: LessonGroup[]
}

/** Groups today's roster by (current_level_id, current_lesson_number) —
 *  always the student's real CURRENT lesson from student_progress, never
 *  derived from attendance history and never the next lesson — then nests
 *  those groups under their programme in curriculum order (sort_order),
 *  lesson number, then student name. */
export function groupLessonsToday(
  roster: LessonsTodayRosterEntry[],
  levels: Pick<Level, 'id' | 'name' | 'sort_order'>[],
): ProgrammeGroup[] {
  const levelById = new Map(levels.map((l) => [l.id, l]))
  const byKey = new Map<string, LessonGroup>()

  for (const s of roster) {
    const p = s.progress
    if (!p || p.current_lesson_number == null || p.current_level_id == null) continue
    const key = `${p.current_level_id}:${p.current_lesson_number}`
    let g = byKey.get(key)
    if (!g) {
      g = {
        levelId: p.current_level_id,
        levelName: p.level_name ?? levelById.get(p.current_level_id)?.name ?? '',
        lessonNumber: p.current_lesson_number,
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
