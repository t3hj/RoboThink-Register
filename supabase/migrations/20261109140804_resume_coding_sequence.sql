-- Keep the stored pointer aligned with the Register when coding returns to an
-- earlier sequence. A single repeat/catch-up must never rewind progression.
create schema if not exists private;
create or replace function private.resume_coding_sequence()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  current_id uuid;
  latest record;
  previous record;
  checkpoint timestamptz;
begin
  -- RPCs link the lesson record after saving the session and its lesson record.
  -- Running on that linkage avoids advancing twice or using an old record.
  if new.lesson_record_id is null or new.outcome <> 'completed' then return new; end if;
  if not exists (
    select 1 from public.profiles where auth_id = auth.uid() and role in ('admin', 'instructor')
  ) or not public.can_access_student(new.student_id) then return new; end if;

  select s.current_lesson_id into current_id
  from public.students s
  join public.lessons l on l.id = s.current_lesson_id and l.lesson_kind = 'normal'
  join public.levels lv on lv.id = l.level_id and lv.slug = 'coding'
  where s.id = new.student_id and s.pending_assessment_point_id is null
    and s.override_next_lesson is null
  for update of s;
  if current_id is null or exists (
    select 1 from public.remediation_plans where student_id = new.student_id
      and status in ('required', 'in_progress', 'ready_for_reassessment', 'intervention_required')
  ) then return new; end if;

  select max(o.created_at) into checkpoint
  from public.progress_overrides o join public.levels lv on lv.id = o.new_level_id
  join public.lessons l on l.level_id = o.new_level_id and l.lesson_number = o.new_lesson and l.lesson_kind = 'normal'
  where o.student_id = new.student_id and lv.slug = 'coding';

  -- Same order and track filtering as the frontend's progression history.
  select a.* into latest from public.attended_sessions a
  join public.lessons l on l.id = a.actual_lesson_id and l.lesson_kind = 'normal'
  join public.levels lv on lv.id = l.level_id and lv.slug = 'coding'
  where a.student_id = new.student_id
    and (checkpoint is null or (a.created_at > checkpoint and a.date >= (checkpoint at time zone 'UTC')::date))
  order by a.date desc, a.session_number desc, a.created_at desc, a.id desc limit 1;
  if latest.id is distinct from new.id then return new; end if;

  select a.* into previous from public.attended_sessions a
  join public.lessons l on l.id = a.actual_lesson_id and l.lesson_kind = 'normal'
  join public.levels lv on lv.id = l.level_id and lv.slug = 'coding'
  where a.student_id = new.student_id
    and (checkpoint is null or (a.created_at > checkpoint and a.date >= (checkpoint at time zone 'UTC')::date))
  order by a.date desc, a.session_number desc, a.created_at desc, a.id desc limit 1 offset 1;

  if previous.outcome = 'completed'
    and public.next_curriculum_lesson(previous.actual_lesson_id) = latest.actual_lesson_id
    and not public.lesson_is_at_or_beyond(latest.actual_lesson_id, current_id) then
    perform public.advance_after_completion(new.student_id, latest.actual_lesson_id, new.lesson_record_id);
  end if;
  return new;
end;
$$;
revoke all on function private.resume_coding_sequence() from public, anon, authenticated;

drop trigger if exists resume_coding_sequence on public.attended_sessions;
create trigger resume_coding_sequence
  after insert or update of lesson_record_id on public.attended_sessions
  for each row execute function private.resume_coding_sequence();
