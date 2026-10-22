import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth'

interface Guide {
  id: string
  title: string
  summary: string
  steps: string[]
  tip?: string
}

/** Short, task-based instructions. Longer versions live in /docs in the
 *  repository. Nothing here is curriculum content or real student data. */
const GUIDES: Guide[] = [
  {
    id: 'add-student',
    title: 'Add a new student (admins and managers)',
    summary: 'Do this once when a family joins. You can change any of it later.',
    steps: [
      'Open Students and press “+ Add student”.',
      'Enter the full name, the date they joined, their subscription and the centre.',
      'Under Weekly sessions, choose the day and time of each session. Use “+ Add another session” if they come more than once a week.',
      'If they come every other week, set “How often” to “Every other week” and pick any date in a week they attend.',
      'Choose their starting level and lesson, then press “Add student”.',
    ],
    tip: 'Pick the starting lesson carefully — the register recommends the next lesson from it.',
  },
  {
    id: 'import-pebble',
    title: 'Import a venue from Pebble (admins and managers)',
    summary: 'Add many students at once from a Pebble register download.',
    steps: [
      'Download the activity register from Pebble as a spreadsheet (.xlsx).',
      'Open Import from Pebble, choose the venue, then choose the file.',
      'Check the day and start time, match the ticket to a subscription, and read the preview.',
      'Press Import. Existing students are matched by name, so nobody is duplicated.',
    ],
    tip: 'Only name, date of birth, mobile, email and ticket are used. Medical, SEN and everything else in the file is ignored.',
  },
  {
    id: 'starting-lesson',
    title: 'Set a student’s starting lesson',
    summary: 'Students imported from Pebble have no lesson until someone chooses it.',
    steps: [
      'Look for “No lesson set · choose” on the register, or Dashboard, then Students needing a starting lesson.',
      'Open the student and choose their level and lesson under “Choose starting lesson”.',
      'Press Save. This can only be done once; after that their lesson moves on as you record sessions.',
    ],
  },
  {
    id: 'request-student',
    title: 'Ask for a student to be added (instructors)',
    summary: 'Instructors send a request. An admin or manager approves it before the student exists.',
    steps: [
      'Open Student requests and choose the centre.',
      'Enter each student’s name, subscription, weekly sessions and how often they come. Use “+ Add another student” to request several at once.',
      'Press “Send requests for approval”.',
      'Check the list at the bottom of the page for pending, approved or declined, with the reason if declined.',
    ],
    tip: 'Admins and managers: open Student requests and press “Review & add”. The Add student form opens filled in, and the request is approved when you save it.',
  },
  {
    id: 'take-register',
    title: 'Take the register',
    summary: 'Open Today’s Register at the start of the session and mark each student as they arrive.',
    steps: [
      'Open “Today’s Register”. Use Prev / Next or the date box to move to another day.',
      'Press “Attended” when a student arrives, or “Absent” if they are not coming.',
      'For an attended student, choose Normal lesson or Project, pick the lesson actually taught, then choose Completed or Not finished and save.',
      'Record the feedback sheet when it has been given.',
      'Before you leave, check the “recorded” count at the top reads fully complete.',
    ],
    tip: 'Use the tick boxes and the bar at the top to mark several students at once (Mark Attended, Mark Absent, Lesson / Outcome, Not Finished, Feedback). You always get a review before anything is saved.',
  },
  {
    id: 'fortnightly',
    title: 'Students who come every other week',
    summary: 'They are only expected in their “on” weeks, so their off weeks never count as a miss.',
    steps: [
      'An admin or manager edits the student and sets “How often” to “Every other week”.',
      'They pick any date inside one of the student’s “on” weeks. Every second week from then on is an “on” week.',
      'Under Weekly sessions they add both of the student’s sessions. In an on week each one is on the register and counts as a normal session.',
      'In their off weeks they are tucked into a note at the top of the register instead of the list.',
      'If they turn up in an off week anyway, use “+ Add to register” and choose “Catch-up”.',
    ],
  },
  {
    id: 'makeups',
    title: 'Missed a session and made it up',
    summary: 'A missed session that is made up shortly afterwards does not count against attendance.',
    steps: [
      'Mark the missed day as “Absent” on that day’s register. Do not delete it.',
      'When they come to make it up, open that day’s register and use “+ Add to register”, choosing “Catch-up”.',
      'Mark them Attended and record the lesson as normal.',
      'The app pairs the absence with the catch-up automatically whenever the catch-up happens (or up to a week before the absence). There is no deadline. Their history shows a “Made up” label.',
    ],
    tip: 'Catch-ups and special sessions never push someone’s percentage above what their regular sessions earned. They only cancel out an absence.',
  },
  {
    id: 'forgot',
    title: 'I forgot to mark a register',
    summary: 'You can fix any past day.',
    steps: [
      'On the Dashboard, “Registers still to fill in” lists expected students with no mark in the last 14 days.',
      'Press “Open register” beside a name to jump to that day.',
      'Mark Attended or Absent and record the lesson as normal.',
    ],
    tip: 'Until a student is marked, nothing counts for or against them. Unmarked days are not treated as absences.',
  },
  {
    id: 'not-finished',
    title: 'Not finished, repeats and assessments',
    summary: 'Use “Not finished” when the student did not complete the work.',
    steps: [
      'Choose “Not finished” as the outcome. Their progression stays on the same lesson.',
      'Next time, record the same lesson again. The lesson picker’s Recommended list shows it first.',
      'For an assessment lesson, record PASS or FAIL when it is completed. A fail follows the repeat or remediation path automatically.',
    ],
  },
  {
    id: 'corrections',
    title: 'Fix a mistake',
    summary: 'Most things can be corrected from the student’s profile.',
    steps: [
      'Open Students, then the student.',
      'In Learning history you can edit or remove a recorded session, or press “+ Add session” to backfill one.',
      'Attendance history on the same page shows every visit, including catch-ups.',
      'Anything you cannot change yourself (for example moving a student to another centre) is an admin job.',
    ],
  },
]

export default function Help() {
  const { role } = useAuth()
  const operational = role === 'admin' || role === 'instructor'

  return (
    <div>
      <PageHeader title="Help & guides" subtitle="Quick how-tos for everyday tasks" accent="red" />

      <nav aria-label="Guides" className="card p-3 mb-5 flex flex-wrap gap-2">
        {GUIDES.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="btn-ghost text-xs">{g.title}</a>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {GUIDES.map((guide, index) => (
          <section key={guide.id} id={guide.id} className="card card-accent-top p-4 sm:p-5 scroll-mt-6" style={{ '--accent-color': ['var(--rt-yellow)', 'var(--rt-green)', 'var(--rt-blue)', 'var(--rt-red)'][index % 4] } as React.CSSProperties}>
            <h2 className="text-lg font-semibold">{guide.title}</h2>
            <p className="text-sm text-slate-500 mb-3">{guide.summary}</p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm">
              {guide.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {guide.tip && (
              <p className="mt-3 text-sm rounded-lg bg-[color:var(--rt-yellow-tint)] px-3 py-2">
                <span className="font-semibold">Tip: </span>{guide.tip}
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="card p-4 sm:p-5 mt-4">
        <h2 className="text-lg font-semibold mb-2">Something not working?</h2>
        <ul className="list-disc pl-5 space-y-1.5 text-sm">
          <li>Can’t sign in: request a new magic link and use the newest email. If it still fails, an admin needs to link your account to a staff profile.</li>
          <li>A student is missing from the register: check their day, that they are Active, that you are on the right centre, and whether they are fortnightly and off this week.</li>
          <li>Wrong lesson suggested: use the lesson picker’s “All lessons” to choose the right one. An admin can correct a student’s current lesson.</li>
        </ul>
        {operational && (
          <p className="text-sm mt-3">
            Back to <Link to="/register" className="text-[color:var(--rt-primary)] font-medium hover:underline">today’s register</Link>.
          </p>
        )}
      </section>
    </div>
  )
}
