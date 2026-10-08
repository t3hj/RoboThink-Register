import { describe, it, expect } from 'vitest'
import { deriveExpectedLesson, nextLessonAfter, type CompletedLesson } from '../src/lib/expectedLesson'

// Curriculum shape mirrors the live levels/lessons naming convention.
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
    id: `L${levelId}-${i + 1}`,
    level_id: levelId,
    lesson_number: i + 1,
    title: `Level ${levelId} Lesson ${i + 1}`,
  }))
}

const lessons = [...lessonsFor(1, 12), ...lessonsFor(7, 12), ...lessonsFor(8, 12), ...lessonsFor(9, 12), ...lessonsFor(17, 12), ...lessonsFor(30, 4)]

function completed(levelId: number, upTo: number): CompletedLesson[] {
  return Array.from({ length: upTo }, (_, i) => ({ level_id: levelId, lesson_number: i + 1 }))
}

describe('nextLessonAfter — term-aware curriculum progression', () => {
  it('advances within the same level', () => {
    expect(nextLessonAfter(8, 5, levels, lessons)?.lesson_number).toBe(6)
  })
  it('rolls over to lesson 1 of the next term at the end of a term', () => {
    const next = nextLessonAfter(8, 12, levels, lessons)
    expect(next?.level_id).toBe(9)
    expect(next?.lesson_number).toBe(1)
  })
  it('keeps the coding track separate from the main programme', () => {
    const next = nextLessonAfter(30, 2, levels, lessons)
    expect(next?.level_id).toBe(30)
    expect(next?.lesson_number).toBe(3)
  })
  it('returns null after the last lesson of the last level', () => {
    expect(nextLessonAfter(17, 12, levels, lessons)).toBeNull()
  })
})

describe('deriveExpectedLesson — derived from the recorded history, not the stored pointer', () => {
  it('backfilled history: Lesson 5 completed, so the next session defaults to Lesson 6', () => {
    // The stored pointer was never advanced past 5 by the backfill.
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 5) },
      levels,
      lessons,
    )
    expect(expected?.level_id).toBe(8)
    expect(expected?.lesson_number).toBe(6)
  })

  it('is not limited to one lesson — a longer backfill lands on the lesson after the latest completed one', () => {
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 9) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(10)
  })

  it('a repeated lesson does not advance (repeats share the one completed row)', () => {
    // Repeating lesson 5 leaves exactly one completed row for lesson 5.
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 5) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(6)
  })

  it('a "not finished" lesson never advances — only COMPLETED records count', () => {
    // Lesson 5 was attempted and left not-finished, so it is not part of the
    // completed history and stays the lesson the student is expected to do.
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 4) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(5)
  })

  it('a catch-up session on an earlier lesson does not skip forward', () => {
    // Completed 1..7, then a catch-up re-did lesson 3 (same row, still one entry).
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 7) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(8)
  })

  it('rolls into the next term when the last lesson of a term is the latest completed one', () => {
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 12) },
      levels,
      lessons,
    )
    expect(expected?.level_id).toBe(9)
    expect(expected?.lesson_number).toBe(1)
  })

  it('keeps the stored current lesson while an assessment or remediation is pending', () => {
    for (const kind of ['assessment', 'remediation', 'complete'] as const) {
      expect(
        deriveExpectedLesson(
          { currentLevelId: 8, currentKind: kind, overrideNextLesson: null, completed: completed(8, 5) },
          levels,
          lessons,
        ),
      ).toBeNull()
    }
  })

  it('honours an explicit override that is ahead of the history', () => {
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: 9, completed: completed(8, 5) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(9)
  })

  it('ignores an override that is not ahead of the history', () => {
    const expected = deriveExpectedLesson(
      { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: 3, completed: completed(8, 5) },
      levels,
      lessons,
    )
    expect(expected?.lesson_number).toBe(6)
  })

  it('falls back to the stored current lesson when there is no completed history in the level', () => {
    expect(
      deriveExpectedLesson(
        { currentLevelId: 8, currentKind: 'normal', overrideNextLesson: null, completed: [] },
        levels,
        lessons,
      ),
    ).toBeNull()
  })

  it('ignores completed history from a different level', () => {
    expect(
      deriveExpectedLesson(
        { currentLevelId: 9, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 12) },
        levels,
        lessons,
      ),
    ).toBeNull()
  })

  it('returns null with no current level', () => {
    expect(
      deriveExpectedLesson(
        { currentLevelId: null, currentKind: 'normal', overrideNextLesson: null, completed: completed(8, 5) },
        levels,
        lessons,
      ),
    ).toBeNull()
  })
})

describe('deriveExpectedLesson — several students with different progression histories', () => {
  it('each next scheduled session shows the lesson following that student\'s latest completed lesson', () => {
    const roster = [
      { name: 'Backfilled to L5', input: { currentLevelId: 8, currentKind: 'normal' as const, overrideNextLesson: null, completed: completed(8, 5) }, want: [8, 6] },
      { name: 'Backfilled across a term boundary', input: { currentLevelId: 8, currentKind: 'normal' as const, overrideNextLesson: null, completed: completed(8, 12) }, want: [9, 1] },
      { name: 'Fresh student, no history', input: { currentLevelId: 7, currentKind: 'normal' as const, overrideNextLesson: null, completed: [] }, want: null },
      { name: 'Up to date, mid-term', input: { currentLevelId: 7, currentKind: 'normal' as const, overrideNextLesson: null, completed: completed(7, 4) }, want: [7, 5] },
      { name: 'Repeat in progress', input: { currentLevelId: 8, currentKind: 'normal' as const, overrideNextLesson: null, completed: completed(8, 6) }, want: [8, 7] },
      { name: 'Assessment pending', input: { currentLevelId: 9, currentKind: 'assessment' as const, overrideNextLesson: null, completed: completed(9, 3) }, want: null },
    ]

    for (const student of roster) {
      const expected = deriveExpectedLesson(student.input, levels, lessons)
      if (student.want == null) {
        expect(expected, student.name).toBeNull()
      } else {
        expect([expected?.level_id, expected?.lesson_number], student.name).toEqual(student.want)
      }
    }
  })
})
