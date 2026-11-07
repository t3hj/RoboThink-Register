BEGIN;
CREATE TEMP TABLE attendance_check_result (scenario text, affected integer);
DO $$
DECLARE target record; n integer;
BEGIN
 SELECT a.id AS attendance_id, p.id AS staff_id, p.auth_id INTO target
 FROM public.attendance a JOIN public.students s ON s.id=a.student_id
 JOIN public.staff_centres sc ON sc.centre_id=a.centre_id
 JOIN public.profiles p ON p.id=sc.staff_id
 WHERE p.role='instructor' AND p.auth_id IS NOT NULL AND p.active_brand=s.brand
 AND s.centre_id=a.centre_id AND a.instructor_id<>p.id LIMIT 1;
 IF target IS NULL THEN RAISE EXCEPTION 'No shared-register fixture available'; END IF;
 PERFORM set_config('request.jwt.claim.sub',target.auth_id::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.attendance SET instructor_id=target.staff_id WHERE id=target.attendance_id;
 GET DIAGNOSTICS n = ROW_COUNT;
 RESET ROLE;
 IF n <> 1 THEN RAISE EXCEPTION 'Shared attendance update failed'; END IF;
 INSERT INTO attendance_check_result VALUES ('instructor updates colleague attendance',n);
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 SET LOCAL ROLE authenticated;
 UPDATE public.attendance SET instructor_id=instructor_id WHERE id=target.attendance_id;
 GET DIAGNOSTICS n = ROW_COUNT;
 RESET ROLE;
 IF n <> 0 THEN RAISE EXCEPTION 'Unapproved user could update attendance'; END IF;
 INSERT INTO attendance_check_result VALUES ('unapproved user blocked',n);
 PERFORM set_config('request.jwt.claim.sub',target.auth_id::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.attendance SET instructor_id=target.staff_id
 WHERE NOT public.can_access_centre(centre_id);
 GET DIAGNOSTICS n = ROW_COUNT;
 RESET ROLE;
 IF n <> 0 THEN RAISE EXCEPTION 'Cross-centre update allowed'; END IF;
 INSERT INTO attendance_check_result VALUES ('inaccessible centres blocked',n);
END $$;
SELECT * FROM attendance_check_result;
ROLLBACK;
