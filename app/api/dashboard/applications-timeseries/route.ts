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
    cutoffDate.setDate(cutoffDate.getDate() - 29)
    cutoffDate.setHours(0, 0, 0, 0)

    const counts = new Map<string, number>()
    let todayCount = 0
    let beforeCutoffCount = 0

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
        beforeCutoffCount += 1
        continue
      }

      counts.set(dateKey, (counts.get(dateKey) || 0) + 1)
    }

    const series: Array<{ date: string; count: number; cumulative: number }> = []
    const cursor = new Date(cutoffDate)
    const endDate = new Date()
    endDate.setHours(0, 0, 0, 0)

    let runningTotal = beforeCutoffCount

    while (cursor <= endDate) {
      const dateKey = cursor.toISOString().slice(0, 10)
      const count = counts.get(dateKey) || 0
      runningTotal += count
      series.push({ date: dateKey, count, cumulative: runningTotal })
      cursor.setDate(cursor.getDate() + 1)
    }

    return NextResponse.json({ todayCount, series })
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
