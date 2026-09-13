-- Applied directly to the live Supabase project on 2026-09-13.
-- assessment_points was empty, so the PASS/FAIL -> remediation -> reassessment
-- workflow had nothing to trigger against. Seed one active checkpoint after
-- the final lesson of every level. Replace with real assessment points later.
INSERT INTO public.assessment_points (level_id, after_lesson_id, focus_topic, active)
SELECT lv.id, last_lesson.id, 'End of ' || lv.name || ' assessment', true
FROM public.levels lv
JOIN LATERAL (
  SELECT le.id
  FROM public.lessons le
  WHERE le.level_id = lv.id AND le.lesson_kind = 'normal'
  ORDER BY le.lesson_number DESC
  LIMIT 1
) last_lesson ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.assessment_points ap WHERE ap.after_lesson_id = last_lesson.id
);
