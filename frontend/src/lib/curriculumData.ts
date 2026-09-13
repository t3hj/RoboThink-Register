import { supabase } from './supabaseClient'
import type { Level, Lesson } from '../types'

interface CurriculumData {
  levels: Level[]
  lessons: Lesson[]
}

let cache: CurriculumData | null = null
let inflight: Promise<CurriculumData> | null = null

/** Loads every level + every lesson once (small, static-ish dataset — ~19
 *  levels / ~255 lessons) and caches it in memory for the session so every
 *  page that needs "the curriculum" (Register, Students, StudentProfile,
 *  Curriculum, the change-lesson control) doesn't re-fetch it repeatedly. */
export async function loadCurriculum(force = false): Promise<CurriculumData> {
  if (cache && !force) return cache
  if (inflight && !force) return inflight
  inflight = (async () => {
    const [levelsRes, lessonsRes] = await Promise.all([
      supabase.from('levels').select('*').order('sort_order'),
      supabase.from('lessons').select('*').order('level_id').order('lesson_number'),
    ])
    if (levelsRes.error) throw levelsRes.error
    if (lessonsRes.error) throw lessonsRes.error
    const data: CurriculumData = {
      levels: (levelsRes.data ?? []) as Level[],
      lessons: (lessonsRes.data ?? []) as Lesson[],
    }
    cache = data
    return data
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export function clearCurriculumCache() {
  cache = null
}
