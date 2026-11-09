-- A corrected visit must not leave the superseded lesson in learning history.
-- Keep the same session/feedback identities; preserve real repeat occurrences.
create or replace function public.update_attended_session(
  in_session_id uuid, in_actual_lesson_id uuid, in_outcome text,
  in_left_aside boolean default false, in_left_aside_identifier text default null,
  in_left_aside_reason text default null, in_left_aside_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  original public.attended_sessions%rowtype;
  old_record public.lesson_records%rowtype;
  target public.lessons%rowtype;
  new_record_id uuid;
  current_id uuid;
  rewind_pointer boolean := false;
begin
  select id into actor from public.profiles where auth_id=auth.uid() and role in ('admin','instructor');
  if actor is null then raise exception 'Staff authentication is required'; end if;
  if in_outcome is null or in_outcome not in ('completed','not_finished') then raise exception 'Invalid outcome'; end if;
  if in_left_aside and (nullif(btrim(in_left_aside_identifier),'') is null or nullif(btrim(in_left_aside_reason),'') is null) then
    raise exception 'An identifier and reason are required when a build/laptop is left aside';
  end if;
  if in_left_aside and in_left_aside_reason='other' and nullif(btrim(in_left_aside_note),'') is null then
    raise exception 'A note is required when the reason is Other';
  end if;
  select * into target from public.lessons where id=in_actual_lesson_id and lesson_kind='normal';
  if target.id is null then raise exception 'Choose a valid normal lesson'; end if;
  select * into original from public.attended_sessions where id=in_session_id;
  if original.id is null then raise exception 'Session not found'; end if;
  if not public.can_access_centre(original.centre_id) then raise exception 'You do not have access to this session''s centre'; end if;
  -- Same lock order as session creation: student, then its session/history.
  perform 1 from public.students where id=original.student_id for update;
  select * into original from public.attended_sessions where id=in_session_id for update;
  if original.id is null then raise exception 'Session not found'; end if;
  if not public.can_access_centre(original.centre_id) then raise exception 'You do not have access to this session''s centre'; end if;
  if (original.project_id is not null and original.actual_lesson_id is null) or exists(select 1 from public.assessments where attended_session_id=in_session_id)
    or exists(select 1 from public.remediation_lessons where attended_session_id=in_session_id) then
    raise exception 'Use the project or assessment editor for this session';
  end if;
  select * into old_record from public.lesson_records where id=original.lesson_record_id for update;
  if original.actual_lesson_id is distinct from in_actual_lesson_id and old_record.id is not null
    and not exists(select 1 from public.attended_sessions where lesson_record_id=old_record.id and id<>in_session_id)
    and (exists(select 1 from public.term_time_followups where lesson_record_id=old_record.id)
      or exists(select 1 from public.feedback_sheets where lesson_record_id=old_record.id and attended_session_id is distinct from in_session_id)) then
    raise exception 'This lesson has separate feedback or a term follow-up. Ask your administrator to review it before changing the lesson';
  end if;
  select current_lesson_id into current_id from public.students where id=original.student_id;
  -- Rewind only a pointer demonstrably advanced by this latest wrong completion.
  -- Never rewind an override, assessment/remediation state, or later visit.
  rewind_pointer := original.outcome='completed'
    and (original.actual_lesson_id is distinct from in_actual_lesson_id or in_outcome<>'completed')
    and not exists(select 1 from public.attended_sessions where lesson_record_id=old_record.id and id<>in_session_id)
    and current_id=public.next_curriculum_lesson(original.actual_lesson_id)
    and exists(select 1 from public.students s join public.lessons l on l.id=s.current_lesson_id
      where s.id=original.student_id and l.lesson_kind='normal' and s.pending_assessment_point_id is null and s.override_next_lesson is null)
    and not exists(select 1 from public.progress_overrides where student_id=original.student_id and created_at>=original.created_at)
    and not exists(select 1 from public.attended_sessions a where a.student_id=original.student_id
      and (a.date,a.session_number)>(original.date,original.session_number));

  update public.attended_sessions set actual_lesson_id=in_actual_lesson_id,outcome=in_outcome,
    left_aside=in_left_aside,left_aside_identifier=in_left_aside_identifier,
    left_aside_reason=in_left_aside_reason,left_aside_note=in_left_aside_note where id=in_session_id;
  insert into public.lesson_records(student_id,level_id,lesson_number,lesson_id,date,instructor_id,status)
    values(original.student_id,target.level_id,target.lesson_number,target.id,original.date,actor,
      case when in_outcome='completed' then 'completed' else 'not_completed' end)
    on conflict(student_id,level_id,lesson_number) do update set lesson_id=excluded.lesson_id
    returning id into new_record_id;
  update public.attended_sessions set lesson_record_id=new_record_id where id=in_session_id;
  update public.feedback_sheets set lesson_record_id=new_record_id,updated_by=actor where attended_session_id=in_session_id;

  if old_record.id is not null and old_record.id<>new_record_id then
    if exists(select 1 from public.attended_sessions where lesson_record_id=old_record.id) then
      update public.lesson_records lr set date=a.date,instructor_id=a.instructor_id,
        status=case when a.outcome='completed' then 'completed' else 'not_completed' end
      from (select * from public.attended_sessions where lesson_record_id=old_record.id
        order by date desc,session_number desc,created_at desc,id desc limit 1) a where lr.id=old_record.id;
    else
      -- Do not cascade away unrelated legacy feedback or follow-ups.
      if exists(select 1 from public.feedback_sheets where lesson_record_id=old_record.id)
        or exists(select 1 from public.term_time_followups where lesson_record_id=old_record.id) then
        raise exception 'The old lesson still has related records and needs administrator review';
      end if;
      insert into public.audit_log(actor_id,action,object_type,object_id,before,after)
        values(actor,'remove_superseded_lesson','lesson_record',old_record.id::text,to_jsonb(old_record),jsonb_build_object('session_id',in_session_id,'replacement_record_id',new_record_id));
      delete from public.lesson_records where id=old_record.id;
    end if;
  end if;
  -- The summary reflects the latest remaining occurrence, not whichever visit
  -- happened to be edited last. Session-linked feedback retains its own visit.
  update public.lesson_records lr set date=a.date,instructor_id=a.instructor_id,
    status=case when a.outcome='completed' then 'completed' else 'not_completed' end
  from (select * from public.attended_sessions where lesson_record_id=new_record_id
    order by date desc,session_number desc,created_at desc,id desc limit 1) a where lr.id=new_record_id;

  if not exists(select 1 from public.remediation_plans where student_id=original.student_id
    and status in ('required','in_progress','ready_for_reassessment','intervention_required')) then
    select current_lesson_id into current_id from public.students where id=original.student_id;
    if in_outcome='completed' and (rewind_pointer or public.lesson_is_at_or_beyond(target.id,current_id)) then
      perform public.advance_after_completion(original.student_id,target.id,new_record_id);
    elsif rewind_pointer and in_outcome='not_finished' then
      update public.students set current_lesson_id=target.id,current_level_id=target.level_id where id=original.student_id;
    end if;
  end if;
  insert into public.audit_log(actor_id,action,object_type,object_id,before,after)
    values(actor,'correct_session_lesson','attended_session',in_session_id::text,to_jsonb(original),
      (select to_jsonb(a) from public.attended_sessions a where id=in_session_id));
end;
$$;
revoke all on function public.update_attended_session(uuid,uuid,text,boolean,text,text,text) from public,anon;
grant execute on function public.update_attended_session(uuid,uuid,text,boolean,text,text,text) to authenticated,service_role;

-- A lesson summary can represent repeated visits. Never edit an arbitrary one.
create or replace function public.update_lesson_history(in_lesson_record_id uuid,in_date date,in_lesson_id uuid,in_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; source public.lesson_records%rowtype; visit public.attended_sessions%rowtype; n integer; target public.lessons%rowtype;
begin
  select id into actor from public.profiles where auth_id=auth.uid() and role in ('admin','instructor');
  if actor is null then raise exception 'Staff authentication is required'; end if;
  if in_date is null or in_date>current_date then raise exception 'Lesson date cannot be in the future'; end if;
  if in_outcome is null or in_outcome not in ('completed','not_finished') then raise exception 'Invalid outcome'; end if;
  select * into source from public.lesson_records where id=in_lesson_record_id;
  if source.id is null then raise exception 'Lesson history entry not found'; end if;
  if not public.can_access_student(source.student_id) then raise exception 'You do not have access to this student''s centre'; end if;
  perform 1 from public.students where id=source.student_id for update;
  select * into source from public.lesson_records where id=in_lesson_record_id for update;
  if source.id is null then raise exception 'Lesson history entry not found'; end if;
  select count(*) into n from public.attended_sessions where lesson_record_id=source.id;
  if n>1 then raise exception 'This lesson has multiple recorded sessions. Open the Register for the session date to correct that visit'; end if;
  if n=1 then
    select * into visit from public.attended_sessions where lesson_record_id=source.id for update;
    if not public.can_access_centre(visit.centre_id) then raise exception 'You do not have access to this session''s centre'; end if;
    if visit.date<>in_date then
      update public.attended_sessions set date=in_date,session_number=(select coalesce(max(session_number),0)+1 from public.attended_sessions where student_id=source.student_id and date=in_date) where id=visit.id;
    end if;
    perform public.update_attended_session(visit.id,in_lesson_id,in_outcome,visit.left_aside,visit.left_aside_identifier,visit.left_aside_reason,visit.left_aside_note);
  else
    select * into target from public.lessons where id=in_lesson_id and lesson_kind='normal';
    if target.id is null then raise exception 'Choose a valid normal lesson'; end if;
    update public.lesson_records set date=in_date,level_id=target.level_id,lesson_number=target.lesson_number,
      lesson_id=target.id,status=case when in_outcome='completed' then 'completed' else 'not_completed' end where id=source.id;
    insert into public.audit_log(actor_id,action,object_type,object_id,before,after)
      values(actor,'correct_legacy_lesson','lesson_record',source.id::text,to_jsonb(source),
        (select to_jsonb(lr) from public.lesson_records lr where id=source.id));
  end if;
end;
$$;
revoke all on function public.update_lesson_history(uuid,date,uuid,text) from public,anon;
grant execute on function public.update_lesson_history(uuid,date,uuid,text) to authenticated,service_role;

-- Explicit removal for an unlinked history entry; never delete a hidden visit.
create or replace function public.delete_unlinked_lesson_history(in_lesson_record_id uuid,in_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; source public.lesson_records%rowtype; feedback_snapshot jsonb;
begin
  select id into actor from public.profiles where auth_id=auth.uid() and role in ('admin','instructor');
  if actor is null then raise exception 'Staff authentication is required'; end if;
  if nullif(btrim(in_reason),'') is null then raise exception 'A reason is required'; end if;
  select * into source from public.lesson_records where id=in_lesson_record_id;
  if source.id is null then raise exception 'Lesson history entry not found'; end if;
  if not public.can_access_student(source.student_id) then raise exception 'You do not have access to this student''s centre'; end if;
  perform 1 from public.students where id=source.student_id for update;
  select * into source from public.lesson_records where id=in_lesson_record_id for update;
  if source.id is null then raise exception 'Lesson history entry not found'; end if;
  if exists(select 1 from public.attended_sessions where lesson_record_id=source.id) then
    raise exception 'This lesson has a recorded session. Correct or remove that session instead';
  end if;
  if exists(select 1 from public.term_time_followups where lesson_record_id=source.id) then
    raise exception 'This lesson is used by a term follow-up and needs administrator review';
  end if;
  -- Preserve feedback attached to an actual visit, even if a historic bug left
  -- its lesson link pointing to this orphan. Only standalone feedback is removed.
  update public.feedback_sheets f set lesson_record_id=a.lesson_record_id,updated_by=actor
    from public.attended_sessions a where f.lesson_record_id=source.id and f.attended_session_id=a.id
      and a.student_id=source.student_id and a.lesson_record_id is distinct from source.id;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into feedback_snapshot
    from public.feedback_sheets f where f.lesson_record_id=source.id;
  insert into public.audit_log(actor_id,action,object_type,object_id,before,after)
    values(actor,'remove_unlinked_lesson','lesson_record',source.id::text,
      jsonb_build_object('lesson_record',to_jsonb(source),'standalone_feedback',feedback_snapshot),jsonb_build_object('reason',btrim(in_reason)));
  delete from public.lesson_records where id=source.id;
end;
$$;
revoke all on function public.delete_unlinked_lesson_history(uuid,text) from public,anon;
grant execute on function public.delete_unlinked_lesson_history(uuid,text) to authenticated,service_role;
