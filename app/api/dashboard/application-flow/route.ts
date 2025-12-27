import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

type ApplicationFlowResponse = {
  stages: {
    applied: number
    interviewScheduled: number
    interviewCompleted: number
    offerReceived: number
  }
  dropOffs: {
    rejected: number
    withdrawn: number
    rejectedAfterInterview: number
  }
}

const STATUS_TO_STAGE: Record<string, keyof ApplicationFlowResponse["stages"]> = {
  Applied: "applied",
  "Interview Scheduled": "interviewScheduled",
  "Interview Completed": "interviewCompleted",
  "Offer Received": "offerReceived",
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
      .select("status")
      .eq("user_id", user.id)

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 })
    }

    const { data: interviewRounds, error: interviewsError } = await supabase
      .from("interview_rounds")
      .select("application_id,result")
      .eq("user_id", user.id)

    if (interviewsError) {
      return NextResponse.json({ error: interviewsError.message }, { status: 500 })
    }

    const response: ApplicationFlowResponse = {
      stages: {
        applied: 0,
        interviewScheduled: 0,
        interviewCompleted: 0,
        offerReceived: 0,
      },
      dropOffs: {
        rejected: 0,
        withdrawn: 0,
        rejectedAfterInterview: 0,
      },
    }

    for (const application of applications) {
      const stageKey = STATUS_TO_STAGE[application.status]
      if (stageKey) {
        response.stages[stageKey] += 1
        continue
      }

      if (application.status === "Rejected") {
        response.dropOffs.rejected += 1
      }

      if (application.status === "Withdrawn") {
        response.dropOffs.withdrawn += 1
      }
    }

    const rejectedAfterInterview = new Set<string>()
    for (const round of interviewRounds) {
      if (round.result === "Failed" && round.application_id) {
        rejectedAfterInterview.add(round.application_id)
      }
    }
    response.dropOffs.rejectedAfterInterview = rejectedAfterInterview.size

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
