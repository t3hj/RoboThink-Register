// Helpers for working with RoboThink's curriculum shape, where each "term"
// of a term-based programme (Junior Engineer, Engineer, Advanced Engineer) is
// stored as its own row in `levels` (e.g. slug 'engineer-term-2', name
// 'Engineer - Term 2'), while Expert Engineer / Master Engineer / Coding are
// single, non-termed levels. This file is the ONLY place that should know
// about that naming convention — pages should call these helpers rather than
// parsing level names/slugs themselves.

import type { Level } from '../types'

export interface ProgrammeTerm {
  programme: string
  term: number | null
}

const TERM_RE = /^(.*) - Term (\d+)$/

/** Split a level's display name into its programme and term number (if any). */
export function parseLevelName(name: string): ProgrammeTerm {
  const m = TERM_RE.exec(name)
  if (m) return { programme: m[1], term: Number(m[2]) }
  return { programme: name, term: null }
}

/** Short label for a level, e.g. "Engineer — Term 2" or "Expert Engineer". */
export function levelLabel(level: Pick<Level, 'name'> | null | undefined): string {
  if (!level) return '—'
  const { programme, term } = parseLevelName(level.name)
  return term ? `${programme} — Term ${term}` : programme
}

/** Group a flat list of levels by programme, preserving sort_order within
 *  each programme and ordering programmes by their first appearance. */
export function groupByProgramme<T extends Pick<Level, 'name' | 'sort_order'>>(
  levels: T[],
): { programme: string; levels: T[] }[] {
  const order: string[] = []
  const groups = new Map<string, T[]>()
  for (const lvl of [...levels].sort((a, b) => a.sort_order - b.sort_order)) {
    const { programme } = parseLevelName(lvl.name)
    if (!groups.has(programme)) {
      groups.set(programme, [])
      order.push(programme)
    }
    groups.get(programme)!.push(lvl)
  }
  return order.map((programme) => ({ programme, levels: groups.get(programme)! }))
}

/** Age-based initial programme, mirroring public.initial_programme_for_dob:
 *  age >= 7 at joining -> Engineer, otherwise Junior Engineer. Used only for
 *  an instant UI preview before the row is saved; the database function is
 *  the source of truth and is called via RPC on actual save. */
export function previewInitialProgramme(dob: string, joined: string): 'Engineer' | 'Junior Engineer' | null {
  if (!dob) return null
  const d = new Date(dob)
  const j = new Date(joined || dob)
  const cutoff = new Date(j)
  cutoff.setFullYear(cutoff.getFullYear() - 7)
  return d.getTime() <= cutoff.getTime() ? 'Engineer' : 'Junior Engineer'
}
