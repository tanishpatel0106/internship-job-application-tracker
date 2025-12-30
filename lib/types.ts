export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  interview_reminders_enabled?: boolean | null
  task_reminders_enabled?: boolean | null
  application_updates_enabled?: boolean | null
  time_zone?: string | null
  monthly_application_goal?: number | null
  daily_application_goal?: number | null
  created_at: string
  updated_at: string
}

export interface Application {
  id: string
  user_id: string
  company_name: string
  position_title: string
  application_date: string
  status: "Applied" | "Interview Scheduled" | "Interview Completed" | "Offer Received" | "Rejected" | "Withdrawn"
  job_description?: string
  salary_range?: string
  location?: string
  application_method?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  user_id: string
  application_id?: string
  name: string
  email?: string
  phone?: string
  position?: string
  company?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface InterviewRound {
  id: string
  user_id: string
  application_id?: string
  round_number: number
  interview_type: "Phone Screen" | "Technical" | "Behavioral" | "Panel" | "Final" | "Other"
  scheduled_date?: string
  reminder_24h_sent_at?: string
  reminder_48h_sent_at?: string
  duration_minutes?: number
  interviewer_names?: string
  notes?: string
  feedback?: string
  result?: "Passed" | "Failed" | "Pending" | "Cancelled"
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  user_id: string
  application_id?: string
  title: string
  description?: string
  due_date?: string
  priority: "Low" | "Medium" | "High" | "Critical"
  status: "Pending" | "In Progress" | "Completed" | "Cancelled"
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  user_id: string
  application_id?: string
  filename: string
  file_path: string
  file_size?: number
  file_type?: string
  uploaded_at: string
}
