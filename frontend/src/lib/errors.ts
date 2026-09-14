/** Turns a raw Supabase/Postgres error message into something an instructor
 *  can actually act on, without ever showing raw SQL/constraint text. Falls
 *  back to a generic message rather than exposing the original string. */
export function friendlyMessage(raw: string | null | undefined): string {
  const m = (raw ?? '').toLowerCase()
  if (!m) return 'Something went wrong. Please try again.'
  if (m.includes('jwt') || m.includes('refresh_token') || m.includes('session'))
    return 'Your session has expired — please sign in again.'
  if (m.includes('row-level security') || m.includes('permission denied') || m.includes('rls'))
    return "You don't have permission to do that."
  if (m.includes('violates unique constraint') || m.includes('duplicate key'))
    return 'That record already exists.'
  if (m.includes('violates foreign key constraint'))
    return "That record couldn't be found — it may have been removed."
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed'))
    return "Couldn't reach the server — check your connection and try again."
  // A handful of our own RPCs raise clear, already-instructor-friendly
  // messages (e.g. "Remediation must be resolved first") — pass those
  // through as-is rather than genericising them.
  const knownPassThrough = [
    'remediation must be resolved',
    'staff authentication is required',
    'a reason is required',
    'student has no current lesson',
    'completion date cannot be in the future',
  ]
  if (knownPassThrough.some((k) => m.includes(k))) return raw as string
  return 'Something went wrong. Please try again, and let an admin know if it keeps happening.'
}
