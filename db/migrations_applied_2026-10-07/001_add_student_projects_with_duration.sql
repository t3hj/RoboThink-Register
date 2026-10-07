-- Applied to the live project on 2026-10-07.
-- Projects remain student-owned; the view exposes a duration that advances
-- each day for active work and freezes when a project is completed.
create table public.student_projects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  start_date date not null,
  target_end_date date,
  completed_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'on_hold', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_end_date is null or target_end_date >= start_date),
  check (completed_date is null or completed_date >= start_date),
  check (status <> 'completed' or completed_date is not null)
);

create index student_projects_student_status_idx on public.student_projects(student_id, status, start_date desc);

create or replace function public.set_student_project_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger student_projects_set_updated_at
before update on public.student_projects
for each row execute function public.set_student_project_updated_at();

create or replace view public.student_project_durations
with (security_invoker = true)
as
select p.*,
  case
    when p.status = 'completed' then p.completed_date - p.start_date
    when p.status = 'active' then current_date - p.start_date
    else null
  end as duration_days
from public.student_projects p;

alter table public.student_projects enable row level security;

grant select, insert, update, delete on table public.student_projects to authenticated;

create policy "Staff can view accessible student projects"
on public.student_projects for select to authenticated
using (public.can_access_student(student_id));

create policy "Staff can create accessible student projects"
on public.student_projects for insert to authenticated
with check (public.can_access_student(student_id));

create policy "Staff can update accessible student projects"
on public.student_projects for update to authenticated
using (public.can_access_student(student_id))
with check (public.can_access_student(student_id));

create policy "Staff can delete accessible student projects"
on public.student_projects for delete to authenticated
using (public.can_access_student(student_id));

grant select on public.student_project_durations to authenticated;
