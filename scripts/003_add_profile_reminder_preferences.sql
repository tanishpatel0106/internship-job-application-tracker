ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interview_reminders_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS task_reminders_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS application_updates_enabled BOOLEAN DEFAULT TRUE;
