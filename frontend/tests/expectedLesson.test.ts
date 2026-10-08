import { describe, it, expect } from 'vitest'
import {
  buildProgressionAttempts,
  completedLessonDates,
  deriveExpectedLesson,
  nextLessonAfter,
  resolveExpectedLesson,
  sessionRecommendedLesson,
  type ExpectedLessonInput,
  type ProgressionAttempt,
} from '../src/lib/expectedLesson'
import { groupLessonsToday } from '../src/lib/lessonsToday'
import type { AttendedSession, LessonRecord } from '../src/types'

const levels = [
  { id: 1, slug: 'junior-term-1', name: 'Junior Engineer - Term 1', sort_order: 10 },
  { id: 7, slug: 'engineer-term-1', name: 'Engineer - Term 1', sort_order: 70 },
  { id: 8, slug: 'engineer-term-2', name: 'Engineer - Term 2', sort_order: 80 },
  { id: 9, slug: 'engineer-term-3', name: 'Engineer - Term 3', sort_order: 90 },
  { id: 17, slug: 'expert-engineer', name: 'Expert Engineer', sort_order: 170 },
  { id: 30, slug: 'coding', name: 'Coding', sort_order: 300 },
]

function lessonsFor(levelId: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'L' + levelId + '-' + (i + 1),
    level_id: levelId,
    lesson_number: i + 1,
    title: 'Level ' + levelId + ' Lesson ' + (i + 1),
    lesson_kind: 'normal' as const,
  }))
}

const lessons = [...lessonsFor(1, 12), ...lessonsFor(7, 12), ...lessonsFor(8, 12), ...lessonsFor(9, 12), ...lessonsFor(17, 12), ...lessonsFor(30, 4)]

function attempt(
  level_id: number,
  lesson_number: number,
  outcome: 'completed' | 'not_finished',
  date: string,
  session_number = 1,
  source_id = level_id + '-' + lesson_number + '-' + date + '-' + session_number,
): ProgressionAttempt {
  return { level_id, lesson_number, outcome, date, session_number, created_at: date + 'T10:00:00Z', source_id }
}

function input(attempts: ProgressionAttempt[], extra: Partial<ExpectedLessonInput> = {}): ExpectedLessonInput {
  return {
    currentLevelId: 8,
    currentKind: 'normal',
    overrideNextLesson: null,
    attempts,
    ...extra,
  }
}

function wanted(expected: { level_id: number; lesson_number: number } | null) {
  return expected ? [expected.level_id, expected.lesson_number] : null
}

describe('nextLessonAfter — curriculum boundaries and tracks', () => {
  it('advances within a level', () => {
    expect(nextLessonAfter(8, 5, levels, lessons)?.lesson_number).toBe(6)
  })

  it('rolls the final term lesson into the next term Lesson 1', () => {
    expect(wanted(nextLessonAfter(8, 12, levels, lessons))).toEqual([9, 1])
  })

  it('keeps coding separate from the main curriculum', () => {
    expect(nextLessonAfter(30, 2, levels, lessons)?.level_id).toBe(30)
    expect(nextLessonAfter(30, 2, levels, lessons)?.lesson_number).toBe(3)
  })

  it('returns null after the last curriculum lesson', () => {
    expect(nextLessonAfter(17, 12, levels, lessons)).toBeNull()
  })
})

describe('buildProgressionAttempts — combines the history sources without double counting', () => {
  const sessions: AttendedSession[] = [
    {
      id: 'session-linked', student_id: 'student', date: '2026-01-02', session_number: 1,
      actual_lesson_id: 'L8-6', outcome: 'not_finished', lesson_record_id: 'record-linked',
      instructor_id: null, created_at: '2026-01-02T10:00:00Z', left_aside: false,
      left_aside_identifier: null, left_aside_reason: null, left_aside_note: null,
    },
    {
      id: 'session-unlinked', student_id: 'student', date: '2026-01-03', session_number: 1,
      actual_lesson_id: 'L8-6', outcome: 'completed', lesson_record_id: null,
      instructor_id: null, created_at: '2026-01-03T10:00:00Z', left_aside: false,
      left_aside_identifier: null, left_aside_reason: null, left_aside_note: null,
    },
    {
      id: 'assessment-session', student_id: 'student', date: '2026-01-04', session_number: 1,
      actual_lesson_id: 'A8-1', outcome: 'completed', lesson_record_id: null,
      instructor_id: null, created_at: '2026-01-04T10:00:00Z', left_aside: false,
      left_aside_identifier: null, left_aside_reason: null, left_aside_note: null,
    },
  ]
  const records: LessonRecord[] = [
    {
      id: 'record-linked', student_id: 'student', level_id: 8, lesson_number: 5, lesson_id: 'L8-5',
      date: '2026-01-02', instructor_id: null, status: 'completed', notes: null,
      assessment_result: null, created_at: '2026-01-02T10:00:00Z',
    },
    {
      id: 'record-orphan', student_id: 'student', level_id: 8, lesson_number: 7, lesson_id: 'L8-7',
      date: '2026-01-05', instructor_id: null, status: 'not_completed', notes: null,
      assessment_result: null, created_at: '2026-01-05T10:00:00Z',
    },
  ]
  const curriculum = [
    ...lessons,
    { id: 'A8-1', level_id: 8, lesson_number: 99, title: 'Assessment', lesson_kind: 'assessment' as const },
  ]

  it('uses the linked session occurrence (actual lesson and outcome), includes unlinked legacy attempts, and excludes assessment lessons', () => {
    const attempts = buildProgressionAttempts(sessions, records, curriculum)
    expect(attempts.map((row) => [row.level_id, row.lesson_number, row.outcome])).toEqual([
      [8, 6, 'not_finished'],
      [8, 6, 'completed'],
      [8, 7, 'not_finished'],
    ])
  })
})

describe('completedLessonDates — session-row repeat warning follows occurrence history', () => {
  it('retains an earlier completion when the unique lesson_records row was overwritten by not-finished', () => {
    const dates = completedLessonDates([
      attempt(8, 11, 'completed', '2026-01-01'),
      attempt(8, 11, 'not_finished', '2026-01-08'),
    ])
    expect(dates.get(8)?.get(11)).toBe('2026-01-01')
  })
})

describe('deriveExpectedLesson — ordered progression from actual session history', () => {
  it('Lesson 11 completed recommends Lesson 12', () => {
    expect(wanted(deriveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-01')]), levels, lessons))).toEqual([8, 12])
  })

  it('Lesson 12 completed recommends the next curriculum lesson', () => {
    const longLevelLessons = [...lessons, ...lessonsFor(8, 13).slice(12)]
    expect(wanted(deriveExpectedLesson(input([attempt(8, 12, 'completed', '2026-01-01')]), levels, longLevelLessons))).toEqual([8, 13])
  })

  it('Lesson 12 completed at the actual term boundary recommends next term Lesson 1', () => {
    expect(wanted(deriveExpectedLesson(input([attempt(8, 12, 'completed', '2026-01-01')]), levels, lessons))).toEqual([9, 1])
  })

  it('Lesson 11 not finished repeats Lesson 11 after completed Lesson 10', () => {
    const history = [
      attempt(8, 10, 'completed', '2026-01-01'),
      attempt(8, 11, 'not_finished', '2026-01-08'),
    ]
    expect(wanted(deriveExpectedLesson(input(history), levels, lessons))).toEqual([8, 11])
  })

  it('a completed repeat of Lesson 11 does not regress a student already due Lesson 12', () => {
    const history = [
      attempt(8, 11, 'completed', '2026-01-01'),
      attempt(8, 11, 'completed', '2026-01-08'),
    ]
    expect(wanted(deriveExpectedLesson(input(history), levels, lessons))).toEqual([8, 12])
  })

  it('catch-up completion of the lesson currently due advances exactly one lesson', () => {
    const history = [
      attempt(8, 11, 'completed', '2026-01-01'),
      attempt(8, 12, 'completed', '2026-01-08'),
    ]
    expect(wanted(deriveExpectedLesson(input(history), levels, lessons))).toEqual([9, 1])
  })

  it('an earlier catch-up or repeat cannot advance or rewind progression', () => {
    const history = [
      attempt(8, 11, 'completed', '2026-01-01'),
      attempt(8, 10, 'completed', '2026-01-08'),
    ]
    expect(wanted(deriveExpectedLesson(input(history), levels, lessons))).toEqual([8, 12])
  })

  it('matches the progression RPC when a completed lesson at or beyond the cursor is recorded', () => {
    const longLevelLessons = [...lessons, ...lessonsFor(8, 13).slice(12), ...lessonsFor(8, 14).slice(13)]
    const history = [
      attempt(8, 11, 'completed', '2026-01-01'),
      attempt(8, 13, 'completed', '2026-01-08'),
    ]
    expect(wanted(deriveExpectedLesson(input(history), levels, longLevelLessons))).toEqual([8, 14])
  })

  it('uses the most recent outcome and ignores the selected future Register date', () => {
    const history = [
      attempt(8, 11, 'completed', '2026-01-05'),
      attempt(8, 12, 'not_finished', '2026-01-06'),
    ]
    const futureRegisterRecommendation = deriveExpectedLesson(input(history), levels, lessons)
    const laterFutureRegisterRecommendation = deriveExpectedLesson(input(history), levels, lessons)
    expect(wanted(futureRegisterRecommendation)).toEqual([8, 12])
    expect(wanted(laterFutureRegisterRecommendation)).toEqual([8, 12])
  })

  it('completion on the next attendance advances the following recommendation', () => {
    const after11 = deriveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-05')]), levels, lessons)
    const after12 = deriveExpectedLesson(
      input([
        attempt(8, 11, 'completed', '2026-01-05'),
        attempt(8, 12, 'completed', '2026-01-12'),
      ]),
      levels,
      lessons,
    )
    expect(wanted(after11)).toEqual([8, 12])
    expect(wanted(after12)).toEqual([9, 1])
  })

  it('does not trust a stale stored current lesson when session history advances further', () => {
    const staleStoredLesson = lessons.find((lesson) => lesson.id === 'L8-11')
    const resolution = resolveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-01')]), levels, lessons)
    expect(staleStoredLesson?.lesson_number).toBe(11)
    expect(resolution.source).toBe('history')
    expect(wanted(resolution.lesson)).toEqual([8, 12])
  })

  it('uses a manual progression override as a checkpoint and applies later attempts from that point', () => {
    const history = [
      attempt(8, 5, 'completed', '2026-01-01'),
      { ...attempt(8, 8, 'completed', '2026-01-10'), created_at: '2026-01-10T10:00:00Z' },
    ]
    const resolution = resolveExpectedLesson(
      input(history, {
        progressionOverrides: [{ new_level_id: 8, new_lesson: 8, created_at: '2026-01-05T10:00:00Z' }],
      }),
      levels,
      lessons,
    )
    expect(wanted(resolution.source === 'history' ? resolution.lesson : null)).toEqual([8, 9])
  })

  it('uses the numeric explicit override when history is absent', () => {
    const resolution = resolveExpectedLesson(input([], { overrideNextLesson: 9 }), levels, lessons)
    expect(wanted(resolution.source === 'history' ? resolution.lesson : null)).toEqual([8, 9])
  })

  it('does not let completed history from coding advance the main curriculum', () => {
    expect(wanted(deriveExpectedLesson(input([attempt(30, 3, 'completed', '2026-01-01')]), levels, lessons))).toBeNull()
  })

  it('preserves the stored progression state for assessment, remediation, and completed students', () => {
    for (const kind of ['assessment', 'remediation', 'complete'] as const) {
      expect(resolveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-01')], { currentKind: kind }), levels, lessons))
        .toEqual({ source: 'stored' })
    }
  })

  it('falls back to the stored current lesson when there is no relevant history or override', () => {
    expect(resolveExpectedLesson(input([]), levels, lessons)).toEqual({ source: 'stored' })
  })

  it('keeps history authoritative when curriculum data cannot resolve its next step', () => {
    expect(resolveExpectedLesson(input([attempt(17, 12, 'completed', '2026-01-01')], { currentLevelId: 17 }), levels, lessons))
      .toEqual({ source: 'history', lesson: null })
  })
})

describe('Register recommendation consistency', () => {
  it('shows the same history-derived lesson in LessonsToday and SessionEntryRow defaults', () => {
    const result = resolveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-01')]), levels, lessons)
    expect(result.source).toBe('history')
    if (result.source !== 'history') return

    const topSection = groupLessonsToday(
      [{
        id: 'student',
        full_name: 'Student',
        progress: { current_level_id: 8, current_lesson_number: 11, current_lesson_title: 'Old pointer', level_name: 'Engineer - Term 2' },
        expectedLesson: result.lesson,
      }],
      levels,
    )
    const sessionRowDefault = sessionRecommendedLesson(result.lesson, lessons.find((lesson) => lesson.id === 'L8-11') ?? null)
    expect(topSection[0].groups[0].lessonNumber).toBe(12)
    expect(sessionRowDefault?.lesson_number).toBe(topSection[0].groups[0].lessonNumber)
  })

  it('shows the same repeat lesson after a not-finished session', () => {
    const result = resolveExpectedLesson(
      input([attempt(8, 10, 'completed', '2026-01-01'), attempt(8, 11, 'not_finished', '2026-01-08')]),
      levels,
      lessons,
    )
    expect(result.source).toBe('history')
    if (result.source !== 'history') return
    const topSection = groupLessonsToday(
      [{
        id: 'student',
        full_name: 'Student',
        progress: { current_level_id: 8, current_lesson_number: 12, current_lesson_title: 'Stale pointer', level_name: 'Engineer - Term 2' },
        expectedLesson: result.lesson,
      }],
      levels,
    )
    expect(topSection[0].groups[0].lessonNumber).toBe(11)
    expect(sessionRecommendedLesson(result.lesson, lessons.find((lesson) => lesson.id === 'L8-12') ?? null)?.lesson_number)
      .toBe(topSection[0].groups[0].lessonNumber)
  })

  it('a catch-up Register still recommends the next normal lesson due', () => {
    const result = resolveExpectedLesson(input([attempt(8, 11, 'completed', '2026-01-01')]), levels, lessons)
    expect(result.source).toBe('history')
    if (result.source !== 'history') return
    const catchUpRoster = groupLessonsToday(
      [{
        id: 'student',
        full_name: 'Student',
        progress: { current_level_id: 8, current_lesson_number: 11, current_lesson_title: 'Old pointer', level_name: 'Engineer - Term 2' },
        expectedLesson: result.lesson,
      }],
      levels,
    )
    expect(catchUpRoster[0].groups[0].lessonNumber).toBe(12)
    expect(sessionRecommendedLesson(result.lesson, null)?.lesson_number).toBe(12)
  })

  it('keeps the main curriculum and coding track separate when resolving real histories', () => {
    const result = deriveExpectedLesson(
      input([attempt(8, 11, 'completed', '2026-01-01'), attempt(30, 2, 'completed', '2026-01-02')]),
      levels,
      lessons,
    )
    expect(wanted(result)).toEqual([8, 12])
  })

  it('uses one stored-pointer fallback for both sections when history is not authoritative', () => {
    const stored = lessons.find((lesson) => lesson.id === 'L8-5') ?? null
    const resolution = resolveExpectedLesson(input([], { currentKind: 'remediation' }), levels, lessons)
    expect(resolution).toEqual({ source: 'stored' })

    const sharedLesson = resolution.source === 'history' ? resolution.lesson : stored
    const topSection = groupLessonsToday(
      [{
        id: 'student',
        full_name: 'Student',
        progress: { current_level_id: 8, current_lesson_number: 6, current_lesson_title: 'Different view value', level_name: 'Engineer - Term 2' },
        expectedLesson: sharedLesson,
      }],
      levels,
    )
    const sessionRowDefault = sessionRecommendedLesson(sharedLesson, stored)
    expect(topSection[0].groups[0].lessonNumber).toBe(5)
    expect(sessionRowDefault?.lesson_number).toBe(topSection[0].groups[0].lessonNumber)
  })
})
