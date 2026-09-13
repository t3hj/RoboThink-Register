import { useEffect, useMemo, useState } from 'react'
import type { Level, Lesson } from '../types'
import { groupByProgramme, parseLevelName } from '../lib/curriculum'

interface Props {
  levels: Level[]
  lessons: Lesson[]
  levelId: number | null
  lessonNumber: number | null
  onChange: (levelId: number, lessonNumber: number) => void
  disabled?: boolean
}

/** Three-part picker: Programme -> Term (if the programme has terms) -> Lesson.
 *  Always resolves to a concrete (levelId, lessonNumber) pair so callers can
 *  look up the actual lesson row/id themselves. */
export default function LevelLessonPicker({ levels, lessons, levelId, lessonNumber, onChange, disabled }: Props) {
  const groups = useMemo(() => groupByProgramme(levels), [levels])
  const currentLevel = levels.find((l) => l.id === levelId) ?? null
  const [programme, setProgramme] = useState<string>(currentLevel ? parseLevelName(currentLevel.name).programme : groups[0]?.programme ?? '')

  useEffect(() => {
    if (currentLevel) setProgramme(parseLevelName(currentLevel.name).programme)
  }, [currentLevel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const termsForProgramme = groups.find((g) => g.programme === programme)?.levels ?? []
  const hasTerms = termsForProgramme.some((l) => parseLevelName(l.name).term != null)
  const effectiveLevel =
    currentLevel && parseLevelName(currentLevel.name).programme === programme ? currentLevel : termsForProgramme[0] ?? null
  const lessonsForLevel = lessons
    .filter((l) => l.level_id === effectiveLevel?.id && l.lesson_kind === 'normal')
    .sort((a, b) => a.lesson_number - b.lesson_number)

  function pickProgramme(p: string) {
    setProgramme(p)
    const firstLevel = groups.find((g) => g.programme === p)?.levels[0]
    if (firstLevel) onChange(firstLevel.id, 1)
  }

  function pickTerm(newLevelId: number) {
    onChange(newLevelId, 1)
  }

  function pickLesson(n: number) {
    if (effectiveLevel) onChange(effectiveLevel.id, n)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label className="text-sm">
        <span className="block text-slate-500 mb-1">Programme</span>
        <select
          className="w-full p-2 border border-slate-200 rounded-lg text-sm"
          value={programme}
          disabled={disabled}
          onChange={(e) => pickProgramme(e.target.value)}
        >
          {groups.map((g) => (
            <option key={g.programme} value={g.programme}>
              {g.programme}
            </option>
          ))}
        </select>
      </label>

      {hasTerms && (
        <label className="text-sm">
          <span className="block text-slate-500 mb-1">Term</span>
          <select
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            value={effectiveLevel?.id ?? ''}
            disabled={disabled}
            onChange={(e) => pickTerm(Number(e.target.value))}
          >
            {termsForProgramme.map((l) => (
              <option key={l.id} value={l.id}>
                Term {parseLevelName(l.name).term}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-sm">
        <span className="block text-slate-500 mb-1">Lesson</span>
        <select
          className="w-full p-2 border border-slate-200 rounded-lg text-sm"
          value={lessonNumber ?? ''}
          disabled={disabled || lessonsForLevel.length === 0}
          onChange={(e) => pickLesson(Number(e.target.value))}
        >
          {lessonsForLevel.map((l) => (
            <option key={l.id} value={l.lesson_number}>
              Lesson {l.lesson_number}
              {l.title && l.title !== `Lesson ${l.lesson_number}` ? ` — ${l.title}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
