import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

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

    // Get application statistics
    const { data: applications, error: appsError } = await supabase
      .from("applications")
      .select("status")
      .eq("user_id", user.id)

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 })
    }

    // Get pending tasks count
    const { count: pendingTasks, error: tasksError } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "Pending")

    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 })
    }

    // Get upcoming interviews count
    const { count: upcomingInterviews, error: interviewsError } = await supabase
      .from("interview_rounds")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("scheduled_date", new Date().toISOString())

    if (interviewsError) {
      return NextResponse.json({ error: interviewsError.message }, { status: 500 })
    }

    // Calculate statistics
    const totalApplications = applications.length
    const statusCounts = applications.reduce(
      (acc, app) => {
        acc[app.status] = (acc[app.status] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    const progressedCount = Math.max(0, totalApplications - (statusCounts["Applied"] || 0))

    const stats = {
      totalApplications,
      pendingTasks: pendingTasks || 0,
      upcomingInterviews: upcomingInterviews || 0,
      statusBreakdown: statusCounts,
      responseRate: totalApplications > 0 ? Math.round((progressedCount / totalApplications) * 100) : 0,
    }

    return NextResponse.json(stats)
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
