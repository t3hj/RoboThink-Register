import { describe, it, expect } from 'vitest'
import { groupLessonsToday, type LessonsTodayRosterEntry } from '../src/lib/lessonsToday'

const levels = [
  { id: 1, name: 'Junior Engineer - Term 1', sort_order: 10 },
  { id: 7, name: 'Engineer - Term 1', sort_order: 70 },
  { id: 8, name: 'Engineer - Term 2', sort_order: 80 },
  { id: 17, name: 'Expert Engineer', sort_order: 170 },
]

function entry(id: string, name: string, levelId: number | null, lessonNumber: number | null): LessonsTodayRosterEntry {
  return {
    id,
    full_name: name,
    progress:
      levelId == null || lessonNumber == null
        ? null
        : { current_level_id: levelId, current_lesson_number: lessonNumber, level_name: levels.find((l) => l.id === levelId)?.name ?? '' },
  }
}

describe('groupLessonsToday', () => {
  it('groups students on the same lesson together', () => {
    const roster = [entry('1', 'Student A', 7, 3), entry('2', 'Student B', 7, 3), entry('3', 'Student C', 7, 7)]
    const result = groupLessonsToday(roster, levels)
    const engineer = result.find((p) => p.programme === 'Engineer')!
    const lesson3 = engineer.groups.find((g) => g.lessonNumber === 3)!
    expect(lesson3.students.map((s) => s.full_name)).toEqual(['Student A', 'Student B'])
  })

  it('sorts students within a lesson group alphabetically by name', () => {
    const roster = [entry('1', 'Zoe', 7, 3), entry('2', 'Amir', 7, 3)]
    const result = groupLessonsToday(roster, levels)
    const lesson3 = result[0].groups[0]
    expect(lesson3.students.map((s) => s.full_name)).toEqual(['Amir', 'Zoe'])
  })

  it('sorts programmes by curriculum order (sort_order), then term, then lesson number', () => {
    const roster = [
      entry('1', 'Student D', 8, 2), // Engineer Term 2 Lesson 2
      entry('2', 'Student A', 1, 1), // Junior Term 1 Lesson 1
      entry('3', 'Student C', 7, 7), // Engineer Term 1 Lesson 7
      entry('4', 'Student B', 7, 3), // Engineer Term 1 Lesson 3
    ]
    const result = groupLessonsToday(roster, levels)
    expect(result.map((p) => p.programme)).toEqual(['Junior Engineer', 'Engineer'])
    const engineer = result.find((p) => p.programme === 'Engineer')!
    // Term 1 Lesson 3, Term 1 Lesson 7, Term 2 Lesson 2 — term then lesson number
    expect(engineer.groups.map((g) => `${g.levelName}:${g.lessonNumber}`)).toEqual([
      'Engineer - Term 1:3',
      'Engineer - Term 1:7',
      'Engineer - Term 2:2',
    ])
  })

  it('handles levels with no terms (Expert/Master) without inventing a term', () => {
    const roster = [entry('1', 'Student E', 17, 5)]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].programme).toBe('Expert Engineer')
    expect(result[0].groups[0].lessonNumber).toBe(5)
  })

  it('excludes students with no current lesson (e.g. curriculum complete)', () => {
    const roster = [entry('1', 'Student F', null, null), entry('2', 'Student G', 7, 4)]
    const result = groupLessonsToday(roster, levels)
    const allNames = result.flatMap((p) => p.groups.flatMap((g) => g.students.map((s) => s.full_name)))
    expect(allNames).toEqual(['Student G'])
  })

  it('is a pure function of the roster passed in, so a repeated (not-finished) lesson keeps the student under the same lesson number', () => {
    // Repeating a lesson never changes current_lesson_number, so calling
    // this twice with the same progress produces the same grouping.
    const roster = [entry('1', 'Student A', 7, 5)]
    const before = groupLessonsToday(roster, levels)
    const after = groupLessonsToday(roster, levels) // simulates re-render after a "Not Finished" click
    expect(before).toEqual(after)
  })
})
