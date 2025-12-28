import { z } from "zod"

export const applicationSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  position_title: z.string().min(1, "Position title is required"),
  application_date: z.string().min(1, "Application date is required"),
  status: z.enum(["Applied", "Interview Scheduled", "Interview Completed", "Offer Received", "Rejected", "Withdrawn"]),
  job_description: z.string().optional(),
  salary_range: z.string().optional(),
  location: z.string().optional(),
  application_method: z.string().optional(),
  notes: z.string().optional(),
})

export const applicationStatusSchema = z.object({
  status: z.enum([
    "Applied",
    "Interview Scheduled",
    "Interview Completed",
    "Offer Received",
    "Rejected",
    "Withdrawn",
  ]),
})

export const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  position: z.string().optional(),
  company: z.string().optional(),
  notes: z.string().optional(),
  application_id: z.string().uuid().optional().nullable(),
})

export const interviewRoundSchema = z.object({
  application_id: z.string().uuid("Invalid application ID").optional().nullable(),
  round_number: z.number().int().positive("Round number must be positive"),
  interview_type: z.enum(["Phone Screen", "Technical", "Behavioral", "Panel", "Final", "Other"]),
  scheduled_date: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  interviewer_names: z.string().optional(),
  notes: z.string().optional(),
  feedback: z.string().optional(),
  result: z.enum(["Passed", "Failed", "Pending", "Cancelled"]).optional(),
})

export const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  due_date: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  status: z.enum(["Pending", "In Progress", "Completed", "Cancelled"]),
  application_id: z.string().uuid().optional().nullable(),
})

export const profileSchema = z.object({
  full_name: z.string().min(1, "Full name is required").optional(),
  interview_reminders_enabled: z.boolean().optional(),
  task_reminders_enabled: z.boolean().optional(),
  application_updates_enabled: z.boolean().optional(),
})
