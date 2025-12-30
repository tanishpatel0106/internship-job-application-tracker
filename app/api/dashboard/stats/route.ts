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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("monthly_application_goal, daily_application_goal")
      .eq("id", user.id)
      .single()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    const { data: applications, error: appsError } = await supabase
      .from("applications")
      .select("application_date, status")
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

    const { data: tasks, error: tasksListError } = await supabase
      .from("tasks")
      .select("created_at, status")
      .eq("user_id", user.id)

    if (tasksListError) {
      return NextResponse.json({ error: tasksListError.message }, { status: 500 })
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

    const { data: interviews, error: interviewsListError } = await supabase
      .from("interview_rounds")
      .select("scheduled_date")
      .eq("user_id", user.id)

    if (interviewsListError) {
      return NextResponse.json({ error: interviewsListError.message }, { status: 500 })
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

    const today = new Date()
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    const toDateKey = (date: Date) => date.toISOString().slice(0, 10)

    const applicationDates = applications
      .map((application) => {
        if (!application.application_date) {
          return null
        }
        const parsed = new Date(application.application_date)
        return Number.isNaN(parsed.getTime()) ? null : parsed
      })
      .filter((value): value is Date => value !== null)

    const dailyCounts = new Map<string, number>()
    for (const date of applicationDates) {
      const key = toDateKey(date)
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1)
    }

    const getCountsForLastDays = (days: number) => {
      const result: number[] = []
      for (let offset = days - 1; offset >= 0; offset -= 1) {
        const cursor = new Date(todayStart)
        cursor.setUTCDate(cursor.getUTCDate() - offset)
        const key = toDateKey(cursor)
        result.push(dailyCounts.get(key) || 0)
      }
      return result
    }

    const sumRange = (start: Date, end: Date) =>
      applicationDates.filter((date) => date >= start && date <= end).length

    const last7Start = new Date(todayStart)
    last7Start.setUTCDate(last7Start.getUTCDate() - 6)
    const prev7Start = new Date(todayStart)
    prev7Start.setUTCDate(prev7Start.getUTCDate() - 13)
    const prev7End = new Date(todayStart)
    prev7End.setUTCDate(prev7End.getUTCDate() - 7)

    const last7Count = sumRange(last7Start, todayStart)
    const prev7Count = sumRange(prev7Start, prev7End)
    const velocityChange =
      prev7Count > 0 ? Math.round(((last7Count - prev7Count) / prev7Count) * 100) : last7Count > 0 ? 100 : 0

    const last7Average = last7Count / 7
    const prev7Average = prev7Count / 7
    const momentumChange =
      prev7Average > 0
        ? Math.round(((last7Average - prev7Average) / prev7Average) * 100)
        : last7Average > 0
          ? 100
          : 0

    const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1))
    const monthCount = sumRange(monthStart, todayStart)
    const lastMonthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() - 1, 1))
    const lastMonthLastDay = new Date(
      Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 0)
    ).getUTCDate()
    const lastMonthSameDay = Math.min(todayStart.getUTCDate(), lastMonthLastDay)
    const lastMonthEnd = new Date(
      Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() - 1, lastMonthSameDay)
    )
    const lastMonthCount = sumRange(lastMonthStart, lastMonthEnd)
    const monthChange =
      lastMonthCount > 0
        ? Math.round(((monthCount - lastMonthCount) / lastMonthCount) * 100)
        : monthCount > 0
          ? 100
          : 0

    const todayKey = toDateKey(todayStart)
    const yesterday = new Date(todayStart)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayKey = toDateKey(yesterday)
    const todayCount = dailyCounts.get(todayKey) || 0
    const yesterdayCount = dailyCounts.get(yesterdayKey) || 0
    const dailyChange =
      yesterdayCount > 0
        ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
        : todayCount > 0
          ? 100
          : 0

    const dailyGoal = profile?.daily_application_goal ?? 0
    const monthlyGoal = profile?.monthly_application_goal ?? 0

    const computeStreak = (startDate: Date) => {
      if (dailyGoal <= 0) {
        return 0
      }
      let streak = 0
      const cursor = new Date(startDate)
      while (true) {
        const key = toDateKey(cursor)
        const count = dailyCounts.get(key) || 0
        if (count < dailyGoal) {
          break
        }
        streak += 1
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      }
      return streak
    }

    const currentStreak = computeStreak(todayStart)
    const previousStreak = computeStreak(yesterday)
    const streakChange =
      previousStreak > 0
        ? Math.round(((currentStreak - previousStreak) / previousStreak) * 100)
        : currentStreak > 0
          ? 100
          : 0

    const silenceCutoff = new Date(todayStart)
    silenceCutoff.setUTCDate(silenceCutoff.getUTCDate() - 14)
    const silenceEligible = applications.filter((app) => {
      if (!app.application_date) return false
      const date = new Date(app.application_date)
      return !Number.isNaN(date.getTime()) && date <= silenceCutoff
    })
    const silenceCount = silenceEligible.filter((app) => app.status === "Applied").length
    const silenceRate =
      silenceEligible.length > 0 ? Math.round((silenceCount / silenceEligible.length) * 100) : 0

    const silencePrevStart = new Date(todayStart)
    silencePrevStart.setUTCDate(silencePrevStart.getUTCDate() - 28)
    const silencePrevEnd = new Date(todayStart)
    silencePrevEnd.setUTCDate(silencePrevEnd.getUTCDate() - 15)
    const silencePrevEligible = applications.filter((app) => {
      if (!app.application_date) return false
      const date = new Date(app.application_date)
      return !Number.isNaN(date.getTime()) && date >= silencePrevStart && date <= silencePrevEnd
    })
    const silencePrevCount = silencePrevEligible.filter((app) => app.status === "Applied").length
    const silencePrevRate =
      silencePrevEligible.length > 0
        ? Math.round((silencePrevCount / silencePrevEligible.length) * 100)
        : 0
    const silenceChange =
      silencePrevRate > 0
        ? Math.round(((silenceRate - silencePrevRate) / silencePrevRate) * 100)
        : silenceRate > 0
          ? 100
          : 0

    const weeklyCounts = new Map<string, number>()
    const weekStarts: Date[] = []
    for (const date of applicationDates) {
      const day = date.getUTCDay()
      const diff = (day + 6) % 7
      const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      weekStart.setUTCDate(weekStart.getUTCDate() - diff)
      const key = toDateKey(weekStart)
      if (!weeklyCounts.has(key)) {
        weekStarts.push(weekStart)
      }
      weeklyCounts.set(key, (weeklyCounts.get(key) || 0) + 1)
    }
    let mostProductiveWeekKey = ""
    let mostProductiveWeekCount = 0
    for (const [key, count] of weeklyCounts) {
      if (count > mostProductiveWeekCount) {
        mostProductiveWeekCount = count
        mostProductiveWeekKey = key
      }
    }
    const recentWeeks = [...weekStarts]
      .sort((a, b) => a.getTime() - b.getTime())
      .slice(-8)
      .map((date) => weeklyCounts.get(toDateKey(date)) || 0)
    const recentWeekAverage =
      recentWeeks.length > 0
        ? recentWeeks.reduce((sum, value) => sum + value, 0) / recentWeeks.length
        : 0
    const mostProductiveChange =
      recentWeekAverage > 0
        ? Math.round(((mostProductiveWeekCount - recentWeekAverage) / recentWeekAverage) * 100)
        : mostProductiveWeekCount > 0
          ? 100
          : 0

    const tasksDates = tasks
      .map((task) => {
        const parsed = new Date(task.created_at)
        return Number.isNaN(parsed.getTime()) ? null : parsed
      })
      .filter((value): value is Date => value !== null)
    const taskDailyCounts = new Map<string, number>()
    for (const date of tasksDates) {
      const key = toDateKey(date)
      taskDailyCounts.set(key, (taskDailyCounts.get(key) || 0) + 1)
    }
    const taskCountsLast14 = getCountsForLastDays(14).map((_, index, arr) => {
      const cursor = new Date(todayStart)
      cursor.setUTCDate(cursor.getUTCDate() - (arr.length - 1 - index))
      return taskDailyCounts.get(toDateKey(cursor)) || 0
    })
    const taskLast7 = taskCountsLast14.slice(-7).reduce((sum, value) => sum + value, 0)
    const taskPrev7 = taskCountsLast14.slice(0, 7).reduce((sum, value) => sum + value, 0)
    const taskChange =
      taskPrev7 > 0 ? Math.round(((taskLast7 - taskPrev7) / taskPrev7) * 100) : taskLast7 > 0 ? 100 : 0

    const interviewDates = interviews
      .map((interview) => {
        if (!interview.scheduled_date) return null
        const parsed = new Date(interview.scheduled_date)
        return Number.isNaN(parsed.getTime()) ? null : parsed
      })
      .filter((value): value is Date => value !== null)
    const interviewDailyCounts = new Map<string, number>()
    for (const date of interviewDates) {
      const key = toDateKey(date)
      interviewDailyCounts.set(key, (interviewDailyCounts.get(key) || 0) + 1)
    }
    const interviewCountsLast14 = getCountsForLastDays(14).map((_, index, arr) => {
      const cursor = new Date(todayStart)
      cursor.setUTCDate(cursor.getUTCDate() - (arr.length - 1 - index))
      return interviewDailyCounts.get(toDateKey(cursor)) || 0
    })
    const interviewLast7 = interviewCountsLast14.slice(-7).reduce((sum, value) => sum + value, 0)
    const interviewPrev7 = interviewCountsLast14.slice(0, 7).reduce((sum, value) => sum + value, 0)
    const interviewChange =
      interviewPrev7 > 0
        ? Math.round(((interviewLast7 - interviewPrev7) / interviewPrev7) * 100)
        : interviewLast7 > 0
          ? 100
          : 0

    const sparklineBase = getCountsForLastDays(14)
    let cumulative = 0
    const cumulativeSparkline = sparklineBase.map((value) => {
      cumulative += value
      return cumulative
    })

    const stats = {
      totalApplications,
      pendingTasks: pendingTasks || 0,
      upcomingInterviews: upcomingInterviews || 0,
      statusBreakdown: statusCounts,
      responseRate: totalApplications > 0 ? Math.round((progressedCount / totalApplications) * 100) : 0,
      kpis: [
        {
          id: "total-applications",
          title: "Total Applications",
          value: totalApplications,
          description: "Applications submitted",
          changePct: velocityChange,
          trend: cumulativeSparkline,
        },
        {
          id: "pending-tasks",
          title: "Pending Tasks",
          value: pendingTasks || 0,
          description: "Tasks to complete",
          changePct: taskChange,
          trend: taskCountsLast14,
        },
        {
          id: "upcoming-interviews",
          title: "Upcoming Interviews",
          value: upcomingInterviews || 0,
          description: "Scheduled interviews",
          changePct: interviewChange,
          trend: interviewCountsLast14,
        },
        {
          id: "monthly-goal",
          title: "Monthly Application Goal",
          value: monthlyGoal > 0 ? `${monthCount}/${monthlyGoal}` : "Set a goal",
          description: "Month-to-date progress",
          changePct: monthChange,
          trend: sparklineBase,
          progress: monthlyGoal > 0 ? Math.min(monthCount / monthlyGoal, 1) : 0,
        },
        {
          id: "daily-goal",
          title: "Daily Application Goal",
          value: dailyGoal > 0 ? `${todayCount}/${dailyGoal}` : "Set a goal",
          description: "Today",
          changePct: dailyChange,
          trend: sparklineBase,
          progress: dailyGoal > 0 ? Math.min(todayCount / dailyGoal, 1) : 0,
        },
        {
          id: "velocity-change",
          title: "Application Velocity Change",
          value: `${velocityChange}%`,
          description: "vs last week",
          changePct: velocityChange,
          trend: sparklineBase,
        },
        {
          id: "application-streak",
          title: "Application Streak",
          value: `${currentStreak} days`,
          description: "Days meeting daily goal",
          changePct: streakChange,
          trend: sparklineBase,
        },
        {
          id: "silence-rate",
          title: "Silence Rate",
          value: `${silenceRate}%`,
          description: "No response after 14 days",
          changePct: silenceChange,
          trend: sparklineBase,
        },
        {
          id: "most-productive-week",
          title: "Most Productive Week",
          value: mostProductiveWeekCount > 0 ? `${mostProductiveWeekCount} apps` : "No data",
          description: mostProductiveWeekKey ? `Week of ${mostProductiveWeekKey}` : "No activity yet",
          changePct: mostProductiveChange,
          trend: sparklineBase,
        },
        {
          id: "current-momentum",
          title: "Current Momentum",
          value: `${last7Average.toFixed(1)}/day`,
          description: "7-day average",
          changePct: momentumChange,
          trend: sparklineBase,
        },
      ],
    }

    return NextResponse.json(stats)
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
