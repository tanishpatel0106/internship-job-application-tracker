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

    const { data: applications, error: appsError } = await supabase
      .from("applications")
      .select("application_date")
      .eq("user_id", user.id)

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 })
    }

    const todayKey = new Date().toISOString().slice(0, 10)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 89)
    cutoffDate.setHours(0, 0, 0, 0)

    const counts = new Map<string, number>()
    let todayCount = 0

    for (const application of applications) {
      if (!application.application_date) {
        continue
      }

      const applicationDate = new Date(application.application_date)
      if (Number.isNaN(applicationDate.getTime())) {
        continue
      }

      const dateKey = applicationDate.toISOString().slice(0, 10)
      if (dateKey === todayKey) {
        todayCount += 1
      }

      if (applicationDate < cutoffDate) {
        continue
      }

      counts.set(dateKey, (counts.get(dateKey) || 0) + 1)
    }

    const series = Array.from(counts.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, count]) => ({ date, count }))

    return NextResponse.json({ todayCount, series })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
