import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const STAGE_SEQUENCE = ["Applied", "Interview Scheduled", "Interview Completed", "Offer Received"] as const

type ApplicationRow = {
  id: string
  status: string
}

type InterviewRoundRow = {
  application_id: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: applications, error: appsError } = await supabase
      .from("applications")
      .select("id,status")
      .eq("user_id", user.id)

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 })
    }

    const { data: interviewRounds, error: interviewError } = await supabase
      .from("interview_rounds")
      .select("application_id")
      .eq("user_id", user.id)

    if (interviewError) {
      return NextResponse.json({ error: interviewError.message }, { status: 500 })
    }

    const safeApplications = (applications ?? []) as ApplicationRow[]
    const safeInterviewRounds = (interviewRounds ?? []) as InterviewRoundRow[]
    const interviewedApplicationIds = new Set(
      safeInterviewRounds.map((round) => round.application_id).filter((id): id is string => Boolean(id)),
    )

    const stageCounts = STAGE_SEQUENCE.map((stage) => ({
      stage,
      count: safeApplications.filter((app) => app.status === stage).length,
    }))

    const rejectedAfterInterview = safeApplications.filter(
      (app) => app.status === "Rejected" && interviewedApplicationIds.has(app.id),
    ).length

    return NextResponse.json({
      stages: stageCounts,
      rejectedAfterInterview,
    })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
