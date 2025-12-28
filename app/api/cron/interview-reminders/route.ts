import { sendInterviewReminderEmail } from "@/lib/email/send"
import { createAdminClient } from "@/lib/supabase/admin"
import { shouldSendReminderEmail } from "@/lib/email/reminder-preferences"
import { NextResponse } from "next/server"

const MAX_REMINDERS_PER_RUN = 50
const WINDOW_BUFFER_HOURS = 1

const getReminderWindow = (now: Date, leadHours: number) => {
  const start = new Date(now.getTime() + (leadHours - WINDOW_BUFFER_HOURS) * 60 * 60 * 1000)
  const end = new Date(now.getTime() + (leadHours + WINDOW_BUFFER_HOURS) * 60 * 60 * 1000)
  return { start, end }
}

const sendRemindersForLead = async ({
  leadHours,
  sentColumn,
}: {
  leadHours: number
  sentColumn: "reminder_24h_sent_at" | "reminder_48h_sent_at"
}) => {
  const supabase = createAdminClient()
  const now = new Date()
  const { start, end } = getReminderWindow(now, leadHours)

  const { data: interviews, error } = await supabase
    .from("interview_rounds")
    .select("id, user_id, scheduled_date, application_id, interview_type, round_number")
    .gte("scheduled_date", start.toISOString())
    .lt("scheduled_date", end.toISOString())
    .is(sentColumn, null)
    .limit(MAX_REMINDERS_PER_RUN)

  if (error || !interviews || interviews.length === 0) {
    return { processed: 0, error: error?.message }
  }

  const userIds = Array.from(new Set(interviews.map((interview) => interview.user_id)))

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, interview_reminders_enabled, task_reminders_enabled, application_updates_enabled")
    .in("id", userIds)

  const profileById = new Map(profiles?.map((profile) => [profile.id, profile]) ?? [])

  let processed = 0

  for (const interview of interviews) {
    const profile = profileById.get(interview.user_id)
    const recipient = profile?.email

    if (!recipient || !shouldSendReminderEmail(profile, "interview")) {
      continue
    }

    const scheduledDate = interview.scheduled_date

    if (!scheduledDate) {
      continue
    }

    const { data: application } = await supabase
      .from("applications")
      .select("company_name")
      .eq("id", interview.application_id)
      .eq("user_id", interview.user_id)
      .single()

    await sendInterviewReminderEmail({
      to: recipient,
      companyName: application?.company_name ?? "your interview",
      scheduledDate,
      leadHours,
      preferences: profile,
    })

    await supabase
      .from("interview_rounds")
      .update({ [sentColumn]: now.toISOString() })
      .eq("id", interview.id)

    processed += 1
  }

  return { processed }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results = await Promise.all([
      sendRemindersForLead({ leadHours: 24, sentColumn: "reminder_24h_sent_at" }),
      sendRemindersForLead({ leadHours: 48, sentColumn: "reminder_48h_sent_at" }),
    ])

    return NextResponse.json({
      results,
      note: `Processed up to ${MAX_REMINDERS_PER_RUN} reminders per lead window.`,
    })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
