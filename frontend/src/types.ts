// Database types for RoboThink Register.
// These match the LIVE Supabase schema (public.*), not the older SQL files
// in db/ — see db/README_SCHEMA_DRIFT.md for details.

export type Role = 'admin' | 'instructor'

export interface Profile {
  id: string
  auth_id: string | null
  name: string
  email: string | null
  role: Role
  created_at: string
}

export interface Subscription {
  id: number
  name: string
}

export interface Level {
  id: number
  slug: string
  name: string
  sort_order: number
}

export type LessonKind = 'normal' | 'assessment'

export interface Lesson {
  id: string
  level_id: number
  lesson_number: number
  title: string
  description: string | null
  materials: string | null
  objectives: string | null
  notes: string | null
  lesson_kind: LessonKind
  focus_topic: string | null
  created_at: string
  levels?: { name: string; slug: string; sort_order: number } | null
}

export interface Student {
  id: string
  full_name: string
  preferred_day: string | null
  preferred_time: string | null
  subscription_id: number | null
  current_level_id: number | null
  current_lesson_id: string | null
  pending_assessment_point_id: string | null
  date_joined: string | null
  date_of_birth: string | null
  active: boolean
  parent_name: string | null
  parent_contact: string | null
  notes: string | null
  override_next_lesson: number | null
  created_at: string
  // Joined relations (when requested via select with foreign key hints)
  levels?: { name: string; slug: string; sort_order: number } | null
  subscriptions?: { name: string } | null
}

/** Mirrors the public.student_progress view — the single source of truth for
 *  "what is this student doing right now" across Register/Dashboard/Profile. */
export type ProgressKind = 'normal' | 'assessment' | 'remediation' | 'complete'

export interface StudentProgress {
  student_id: string
  full_name: string
  current_level_id: number | null
  level_name: string | null
  current_lesson_id: string | null
  current_lesson_number: number | null
  current_lesson_title: string | null
  current_kind: ProgressKind
  lessons_completed: number | null
  lessons_required: number | null
  focus_topic: string | null
  next_lesson_id: string | null
  next_lesson_number: number | null
  next_lesson_title: string | null
  total_lessons: number | null
  next_lesson: number | null
}

export type LessonStatus = 'completed' | 'not_completed'
export type AttendanceStatus = 'Not Arrived' | 'Arrived' | 'Absent' | 'Completed'

export interface LessonRecord {
  id: string
  student_id: string
  level_id: number
  lesson_number: number
  lesson_id: string | null
  date: string
  instructor_id: string | null
  status: LessonStatus
  notes: string | null
  assessment_result: string | null
  created_at: string
  // joined
  profiles?: { name: string } | null
  levels?: { name: string } | null
  lessons?: { title: string } | null
}

export interface Attendance {
  id: string
  student_id: string
  date: string
  scheduled_day: string | null
  actual_day: string | null
  time_in: string | null
  time_out: string | null
  status: AttendanceStatus
  instructor_id: string | null
  catch_up: boolean
  created_at: string
}

export type AssessmentResult = 'PASS' | 'FAIL'

export interface AssessmentPoint {
  id: string
  level_id: number
  after_lesson_id: string
  focus_topic: string | null
  active: boolean
  created_at: string
}

export interface Assessment {
  id: string
  student_id: string
  type: string
  date: string
  result: AssessmentResult | string | null
  score: number | null
  instructor_id: string | null
  notes: string | null
  attempt_number: number
  passed: boolean | null
  remediation_required: boolean
  remediation_plan_id: string | null
  level_id: number | null
  assessment_point_id: string | null
  created_at: string
  // joined
  profiles?: { name: string } | null
  levels?: { name: string } | null
}

export type RemediationStatus =
  | 'required'
  | 'in_progress'
  | 'ready_for_reassessment'
  | 'completed'
  | 'intervention_required'

export interface RemediationPlan {
  id: string
  student_id: string
  level_id: number
  assessment_id: string | null
  assessment_point_id: string | null
  topic: string | null
  lessons_required: number
  lessons_completed: number
  status: RemediationStatus
  created_at: string
  completed_at: string | null
}

export interface RemediationLesson {
  id: string
  remediation_plan_id: string
  student_id: string
  level_id: number
  lesson_number: number
  date: string
  topic: string | null
  notes: string | null
  instructor_id: string | null
  status: LessonStatus
  created_at: string
  profiles?: { name: string } | null
}

export interface DailyAward {
  id: string
  date: string
  builder_id: string | null
  builder_reason: string | null
  coder_id: string | null
  coder_reason: string | null
  recorded_by: string | null
  created_at: string
}

export interface ProgressOverride {
  id: string
  student_id: string
  previous_lesson: number | null
  new_lesson: number
  reason: string
  admin_id: string | null
  created_at: string
  previous_level_id: number | null
  new_level_id: number | null
  previous_lesson_id: string | null
  new_lesson_id: string | null
  profiles?: { name: string } | null
}

/** Mirrors public.students_requiring_assessment_action (dashboard/reports). */
export interface StudentRequiringAction {
  student_id: string
  full_name: string
  current_level: string | null
  action: string
  remediation_lessons_completed: number | null
}
