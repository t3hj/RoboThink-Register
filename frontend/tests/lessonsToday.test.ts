import { describe, it, expect } from 'vitest'
import { groupLessonsToday, type LessonsTodayRosterEntry } from '../src/lib/lessonsToday'

const levels = [
  { id: 1, name: 'Junior Engineer - Term 1', sort_order: 10 },
  { id: 7, name: 'Engineer - Term 1', sort_order: 70 },
  { id: 8, name: 'Engineer - Term 2', sort_order: 80 },
  { id: 17, name: 'Expert Engineer', sort_order: 170 },
]

function entry(id: string, name: string, levelId: number | null, lessonNumber: number | null, lessonTitle: string | null = null): LessonsTodayRosterEntry {
  return {
    id,
    full_name: name,
    progress:
      levelId == null || lessonNumber == null
        ? null
        : {
            current_level_id: levelId,
            current_lesson_number: lessonNumber,
            current_lesson_title: lessonTitle,
            level_name: levels.find((l) => l.id === levelId)?.name ?? '',
          },
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

  it('keeps the lesson title supplied by student progress for the grouped display', () => {
    const roster = [entry('1', 'Student A', 7, 3, 'IR Distance Light')]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].groups[0].lessonTitle).toBe('IR Distance Light')
  })

  it('uses a null title when the curriculum title is unavailable', () => {
    const roster = [entry('1', 'Student A', 7, 3, '   ')]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].groups[0].lessonTitle).toBeNull()
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

describe('groupLessonsToday — prefers the history-derived expected lesson', () => {
  it('groups by the expected lesson (and its title) instead of the stored current lesson', () => {
    const roster: LessonsTodayRosterEntry[] = [
      {
        id: '1',
        full_name: 'Student A',
        progress: { current_level_id: 8, current_lesson_number: 5, current_lesson_title: 'T2 L5', level_name: 'Engineer - Term 2' },
        expectedLesson: { level_id: 8, lesson_number: 6, title: 'T2 L6' },
      },
    ]
    const result = groupLessonsToday(roster, levels)
    const engineer = result.find((p) => p.programme === 'Engineer')!
    expect(engineer.groups.map((g) => `${g.levelName}:${g.lessonNumber}:${g.lessonTitle}`)).toEqual(['Engineer - Term 2:6:T2 L6'])
  })

  it('uses the expected lesson level after a term boundary, not the stored level label', () => {
    const roster: LessonsTodayRosterEntry[] = [
      {
        id: '1',
        full_name: 'Student A',
        progress: { current_level_id: 8, current_lesson_number: 12, current_lesson_title: 'T2 L12', level_name: 'Engineer - Term 2' },
        expectedLesson: { level_id: 17, lesson_number: 1, title: 'Expert L1' },
      },
    ]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].groups.map((g) => `${g.levelName}:${g.lessonNumber}:${g.lessonTitle}`)).toEqual(['Expert Engineer:1:Expert L1'])
  })

  it('does not fall back to a stale pointer when history has no resolvable next lesson', () => {
    const roster: LessonsTodayRosterEntry[] = [
      {
        id: '1',
        full_name: 'Student A',
        progress: { current_level_id: 8, current_lesson_number: 12, current_lesson_title: 'T2 L12', level_name: 'Engineer - Term 2' },
        expectedLesson: null,
      },
    ]
    expect(groupLessonsToday(roster, levels)).toEqual([])
  })

  it('falls back to the stored current lesson when no expected lesson is supplied', () => {
    const roster = [entry('1', 'Student A', 7, 3, 'T1 L3')]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].groups[0].lessonNumber).toBe(3)
  })

  it('still groups a student with no progress row when an expected lesson is supplied', () => {
    const roster: LessonsTodayRosterEntry[] = [
      { id: '1', full_name: 'Student A', progress: null, expectedLesson: { level_id: 7, lesson_number: 4, title: 'T1 L4' } },
    ]
    const result = groupLessonsToday(roster, levels)
    expect(result[0].groups[0].lessonNumber).toBe(4)
    expect(result[0].groups[0].levelName).toBe('Engineer - Term 1')
  })
})
