-- Attendance belongs to the shared centre register, not its first marker.
-- Keep role, brand/centre scope and attribution checks on the resulting row.
ALTER POLICY attendance_update_staff ON public.attendance
USING (
  (public.is_admin() OR public.is_instructor())
  AND public.can_access_centre(centre_id)
  AND public.can_access_student(student_id)
);
