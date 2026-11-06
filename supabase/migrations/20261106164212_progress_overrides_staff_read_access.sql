-- The Register uses these checkpoints when reconstructing the next lesson.
-- Staff must see checkpoints for the same students whose history they can read.
-- Keep overrides_admin_only unchanged: INSERT/UPDATE/DELETE remain admin-only.
CREATE POLICY progress_overrides_select_staff
ON public.progress_overrides
FOR SELECT TO authenticated
USING (
  (public.is_admin() OR public.is_instructor() OR public.is_management())
  AND public.can_access_student(student_id)
);
