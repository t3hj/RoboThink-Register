// Database types for RoboThink Register (matching db/robothink_schema.sql)

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

export interface Lesson {
  id: string
  level_id: number
  lesson_number: number
  title: string
  description: string | null
  materials: string | null
  objectives: string | null
  notes: string | null
  created_at: string
}

export interface Student {
  id: string
  full_name: string
  preferred_day: string | null
  preferred_time: string | null
  subscription_id: number | null
  current_level_id: number | null
  date_joined: string | null
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

export type LessonStatus = 'completed' | 'not_completed'
export type AttendanceStatus = 'Not Arrived' | 'Arrived' | 'Absent' | 'Completed'

export interface LessonRecord {
  id: string
  student_id: string
  level_id: number
  lesson_number: number
  date: string
  instructor_id: string | null
  status: LessonStatus
  notes: string | null
  assessment_result: string | null
  created_at: string
  // joined
  profiles?: { name: string } | null
  levels?: { name: string } | null
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

export interface Assessment {
  id: string
  student_id: string
  type: string
  date: string
  result: string | null
  score: number | null
  instructor_id: string | null
  notes: string | null
  created_at: string
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
