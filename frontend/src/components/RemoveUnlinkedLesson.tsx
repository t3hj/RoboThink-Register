import { useRef, useState } from 'react'
import { ConfirmDialog } from './ui'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'

export default function RemoveUnlinkedLesson({ recordId, lessonNumber, linked, onRemoved }: {
  recordId: string
  lessonNumber: number
  linked: boolean
  onRemoved: () => void | Promise<void>
}) {
  const { notify } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  if (linked) return null

  async function remove() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    try {
      const { error } = await supabase.rpc('delete_unlinked_lesson_history', {
        in_lesson_record_id: recordId,
        in_reason: 'Staff confirmed removal of an incorrect unlinked lesson from the student profile',
      })
      if (error) throw new Error(error.message)
      setOpen(false)
      notify('Unlinked lesson history entry removed', 'success')
      await onRemoved()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove the history entry', 'error')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <>
    <button className="text-rose-700 hover:underline" aria-label={`Remove unlinked Lesson ${lessonNumber} from history`} onClick={() => setOpen(true)}>
      Remove history entry
    </button>
    <ConfirmDialog open={open} title={`Remove Lesson ${lessonNumber} from history ?`}
      message="This removes the unlinked lesson entry and any standalone feedback for it. Feedback attached to a recorded session is kept. Attendance and recorded sessions are kept."
      confirmLabel="Remove history entry" busy={busy} onConfirm={() => void remove()} onCancel={() => !busy && setOpen(false)} />
  </>
}
