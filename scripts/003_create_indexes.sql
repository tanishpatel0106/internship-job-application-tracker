-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_application_date ON public.applications(application_date);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON public.contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_application_id ON public.contacts(application_id);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_user_id ON public.interview_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_application_id ON public.interview_rounds(application_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_application_id ON public.tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_application_id ON public.documents(application_id);
