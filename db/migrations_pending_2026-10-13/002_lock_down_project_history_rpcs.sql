-- Keep the RPCs private to signed-in staff and service-role callers.
REVOKE ALL ON FUNCTION public.record_project_session(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_project_session(uuid, uuid, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_project_session(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_session(uuid, uuid, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_lesson_history(uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_lesson_history(uuid, date, uuid, text) TO authenticated, service_role;
