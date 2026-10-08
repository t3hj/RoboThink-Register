import type { AttendedSession, Lesson, LessonRecord, Level, ProgressKind } from '../types'

/** One normal-lesson attempt in the student's dated progression history. */
export interface ProgressionAttempt {
  level_id: number
  lesson_number: number
  date: string
  outcome: 'completed' | 'not_finished'
  /** Sessions are ordered within a date. Legacy lesson_records have no sequence. */
  session_number: number | null
  created_at: string | null
  source_id: string
}

export interface ProgressionOverrideCheckpoint {
  new_level_id: number | null
  new_lesson: number
  created_at: string
}

export interface ExpectedLessonInput {
  currentLevelId: number | null
  currentKind: ProgressKind | null
  overrideNextLesson: number | null
  /** Session ledger plus lesson_records that have no corresponding session. */
  attempts: ProgressionAttempt[]
  /** Audited set_student_current_lesson changes, used as explicit history checkpoints. */
  progressionOverrides?: ProgressionOverrideCheckpoint[]
}

export type ExpectedLessonResolution<L> =
  | { source: 'stored' }
  | { source: 'history'; lesson: L | null }

type LevelRef = Pick<Level, 'id' | 'slug' | 'sort_order'>
type LessonRef = Pick<Lesson, 'id' | 'level_id' | 'lesson_number' | 'title' | 'lesson_kind'>

type SessionAttemptSource = Pick<
  AttendedSession,
  'id' | 'date' | 'session_number' | 'actual_lesson_id' | 'outcome' | 'lesson_record_id' | 'created_at'
>
type LessonRecordSource = Pick<
  LessonRecord,
  'id' | 'date' | 'level_id' | 'lesson_number' | 'status' | 'created_at'
>

/**
 * Merge the append-only session ledger with legacy/backfilled lesson_records.
 * A lesson_record linked from a session is represented by that session (its
 * actual_lesson_id and outcome are the authoritative occurrence); unlinked
 * records remain usable as legacy attempts.
 */
export function buildProgressionAttempts<L extends LessonRef>(
  sessions: SessionAttemptSource[],
  lessonRecords: LessonRecordSource[],
  lessons: L[],
): ProgressionAttempt[] {
  const normalLessonById = new Map(
    lessons.filter((lesson) => lesson.lesson_kind === 'normal').map((lesson) => [lesson.id, lesson]),
  )
  const normalLessonByKey = new Map(
    lessons
      .filter((lesson) => lesson.lesson_kind === 'normal')
      .map((lesson) => [lesson.level_id + ':' + lesson.lesson_number, lesson]),
  )
  const linkedRecordIds = new Set(
    sessions.flatMap((session) => session.lesson_record_id ? [session.lesson_record_id] : []),
  )

  const sessionAttempts = sessions.flatMap((session) => {
    const lesson = normalLessonById.get(session.actual_lesson_id)
    return lesson
      ? [{
          level_id: lesson.level_id,
          lesson_number: lesson.lesson_number,
          date: session.date,
          outcome: session.outcome,
          session_number: session.session_number,
          created_at: session.created_at,
          source_id: session.id,
        }]
      : []
  })

  const legacyAttempts = lessonRecords.flatMap((record) => {
    if (linkedRecordIds.has(record.id)) return []
    const lesson = normalLessonByKey.get(record.level_id + ':' + record.lesson_number)
    return lesson
      ? [{
          level_id: lesson.level_id,
          lesson_number: lesson.lesson_number,
          date: record.date,
          outcome: record.status === 'completed' ? 'completed' as const : 'not_finished' as const,
          session_number: null,
          created_at: record.created_at,
          source_id: record.id,
        }]
      : []
  })

  return [...sessionAttempts, ...legacyAttempts].sort(compareAttempts)
}

/** Any completed occurrence counts for the session-row repeat warning, even
 * when the single lesson_records row was later overwritten by a not-finished attempt. */
export function completedLessonDates(attempts: ProgressionAttempt[]): Map<number, Map<number, string>> {
  const dates = new Map<number, Map<number, string>>()
  for (const attempt of attempts) {
    if (attempt.outcome !== 'completed') continue
    const byLesson = dates.get(attempt.level_id) ?? new Map<number, string>()
    const existingDate = byLesson.get(attempt.lesson_number)
    if (existingDate == null || attempt.date < existingDate) byLesson.set(attempt.lesson_number, attempt.date)
    dates.set(attempt.level_id, byLesson)
  }
  return dates
}

function compareAttempts(a: ProgressionAttempt, b: ProgressionAttempt): number {
  const byDate = a.date.localeCompare(b.date)
  if (byDate !== 0) return byDate

  if (a.session_number != null && b.session_number != null && a.session_number !== b.session_number) {
    return a.session_number - b.session_number
  }

  const byCreation = (a.created_at ?? '').localeCompare(b.created_at ?? '')
  if (byCreation !== 0) return byCreation
  if (a.session_number != null && b.session_number == null) return -1
  if (a.session_number == null && b.session_number != null) return 1
  if (a.level_id !== b.level_id) return a.level_id - b.level_id
  if (a.lesson_number !== b.lesson_number) return a.lesson_number - b.lesson_number
  return a.source_id.localeCompare(b.source_id)
}

/** The next lesson in curriculum order after a lesson; Coding stays in its own track. */
export function nextLessonAfter<L extends LessonRef>(
  levelId: number,
  lessonNumber: number,
  levels: LevelRef[],
  lessons: L[],
): L | null {
  const sameLevel = lessons
    .filter((l) => l.lesson_kind === 'normal' && l.level_id === levelId && l.lesson_number > lessonNumber)
    .sort((a, b) => a.lesson_number - b.lesson_number)[0]
  if (sameLevel) return sameLevel

  const currentLevel = levels.find((lv) => lv.id === levelId)
  if (!currentLevel) return null
  const candidateLevels = levels
    .filter((lv) =>
      currentLevel.slug === 'coding'
        ? lv.slug === 'coding' && lv.id !== currentLevel.id
        : lv.slug !== 'coding' && lv.sort_order > currentLevel.sort_order,
    )
    .sort((a, b) => a.sort_order - b.sort_order)
  for (const lv of candidateLevels) {
    const first = lessons.find((l) => l.lesson_kind === 'normal' && l.level_id === lv.id && l.lesson_number === 1)
    if (first) return first
  }
  return null
}

function isSameTrack(level: LevelRef, candidate: LevelRef | undefined): boolean {
  if (!candidate) return false
  return (level.slug === 'coding') === (candidate.slug === 'coding')
}

function lessonAt<L extends LessonRef>(levelId: number, lessonNumber: number, lessons: L[]): L | null {
  return lessons.find(
    (lesson) => lesson.lesson_kind === 'normal' && lesson.level_id === levelId && lesson.lesson_number === lessonNumber,
  ) ?? null
}

function lessonIsAtOrBeyond(candidate: LessonRef, expected: LessonRef, levels: LevelRef[]): boolean {
  const candidateLevel = levels.find((level) => level.id === candidate.level_id)
  const expectedLevel = levels.find((level) => level.id === expected.level_id)
  if (!candidateLevel || !expectedLevel || !isSameTrack(expectedLevel, candidateLevel)) return false
  return candidateLevel.sort_order > expectedLevel.sort_order ||
    (candidate.level_id === expected.level_id && candidate.lesson_number >= expected.lesson_number)
}

/**
 * Reconstruct the next lesson from ordered attempts. The first recorded
 * attempt establishes the student's point in the curriculum. Thereafter a
 * completed attempt at or beyond the cursor advances to the lesson after the
 * actual attempt (matching the progression RPC); earlier repeats/catch-ups
 * and all not-finished attempts leave the cursor unchanged.
 */
export function deriveExpectedLesson<L extends LessonRef>(
  input: ExpectedLessonInput,
  levels: LevelRef[],
  lessons: L[],
): L | null {
  if (input.currentKind !== 'normal' || input.currentLevelId == null) return null
  const currentLevel = levels.find((level) => level.id === input.currentLevelId)
  if (!currentLevel) return null

  const attempts = input.attempts.filter((attempt) =>
    isSameTrack(currentLevel, levels.find((level) => level.id === attempt.level_id)),
  )
  const checkpoints = (input.progressionOverrides ?? [])
    .filter((override) =>
      override.new_level_id != null &&
      isSameTrack(currentLevel, levels.find((level) => level.id === override.new_level_id)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const checkpoint = checkpoints.find((override) =>
    lessonAt(override.new_level_id!, override.new_lesson, lessons) != null,
  )

  let expected: L | null = checkpoint
    ? lessonAt(checkpoint.new_level_id!, checkpoint.new_lesson, lessons)
    : null
  const events = checkpoint
    ? attempts.filter((attempt) =>
        attempt.created_at != null &&
        attempt.created_at > checkpoint.created_at &&
        attempt.date >= checkpoint.created_at.slice(0, 10),
      )
    : attempts

  for (const attempt of events) {
    const attemptedLesson = lessonAt(attempt.level_id, attempt.lesson_number, lessons)
    if (!attemptedLesson) continue

    if (expected == null) {
      expected = attempt.outcome === 'completed'
        ? nextLessonAfter(attempt.level_id, attempt.lesson_number, levels, lessons)
        : attemptedLesson
      continue
    }

    if (attempt.outcome === 'completed' && lessonIsAtOrBeyond(attemptedLesson, expected, levels)) {
      expected = nextLessonAfter(attempt.level_id, attempt.lesson_number, levels, lessons)
    }
  }

  if (input.overrideNextLesson != null) {
    const overridden = lessonAt(input.currentLevelId, input.overrideNextLesson, lessons)
    if (
      overridden &&
      (expected == null ||
        (expected.level_id === input.currentLevelId && input.overrideNextLesson > expected.lesson_number))
    ) {
      return overridden
    }
  }

  return expected
}

/**
 * Resolve whether progression history replaces stored current_lesson_id.
 * A validated explicit override is also history and works without prior attempts.
 */
export function resolveExpectedLesson<L extends LessonRef>(
  input: ExpectedLessonInput,
  levels: LevelRef[],
  lessons: L[],
): ExpectedLessonResolution<L> {
  if (input.currentKind !== 'normal' || input.currentLevelId == null) return { source: 'stored' }

  const level = levels.find((candidate) => candidate.id === input.currentLevelId)
  if (!level) return { source: 'stored' }

  const relevantAttempts = input.attempts.filter((attempt) =>
    isSameTrack(level, levels.find((candidate) => candidate.id === attempt.level_id)),
  )
  const hasCheckpoint = (input.progressionOverrides ?? []).some((override) =>
    override.new_level_id != null &&
    isSameTrack(level, levels.find((candidate) => candidate.id === override.new_level_id)) &&
    lessonAt(override.new_level_id, override.new_lesson, lessons) != null,
  )
  const hasNumericOverride =
    input.overrideNextLesson != null &&
    lessonAt(input.currentLevelId, input.overrideNextLesson, lessons) != null
  if (relevantAttempts.length === 0 && !hasCheckpoint && !hasNumericOverride) return { source: 'stored' }

  return { source: 'history', lesson: deriveExpectedLesson(input, levels, lessons) }
}

/** SessionEntryRow and LessonsToday receive the same resolved recommendation. */
export function sessionRecommendedLesson<L>(
  expectedLesson: L | null | undefined,
  storedLesson: L | null,
): L | null {
  return expectedLesson === undefined ? storedLesson : expectedLesson
}
