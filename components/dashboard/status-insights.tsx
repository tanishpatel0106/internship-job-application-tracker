"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useMemo, useState } from "react"

const STATUS_LABELS = [
  "Applied",
  "Interview Scheduled",
  "Interview Completed",
  "Offer Received",
  "Rejected",
  "Withdrawn",
]

const STATUS_COLORS = {
  Applied: "#3b82f6",
  "Interview Scheduled": "#10b981",
  "Interview Completed": "#f59e0b",
  "Offer Received": "#22c55e",
  Rejected: "#ef4444",
  Withdrawn: "#6b7280",
}

type DashboardStatsData = {
  totalApplications: number
  statusBreakdown?: Record<string, number>
}

export function StatusInsights() {
  const [stats, setStats] = useState<DashboardStatsData>({ totalApplications: 0, statusBreakdown: {} })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/dashboard/stats")
        if (response.ok) {
          const data = (await response.json()) as DashboardStatsData
          setStats(data)
        }
      } catch (error) {
        console.error("Failed to fetch status insights:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  const insights = useMemo(() => {
    const breakdown = stats.statusBreakdown || {}
    const total = stats.totalApplications || 0
    const ranked = STATUS_LABELS.map((status) => ({
      status,
      count: breakdown[status] || 0,
    })).sort((a, b) => b.count - a.count)

    const top = ranked[0] || { status: "Applied", count: 0 }
    const rejectionCount = (breakdown["Rejected"] || 0) + (breakdown["Withdrawn"] || 0)
    const rejectionRate = total > 0 ? Math.round((rejectionCount / total) * 100) : 0

    return {
      top,
      rejectionRate,
      total,
    }
  }, [stats])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status Insights</CardTitle>
          <CardDescription>Highlights from your application statuses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[180px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading insights...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!insights.total) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status Insights</CardTitle>
          <CardDescription>Highlights from your application statuses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[180px] flex items-center justify-center">
            <div className="text-muted-foreground">No applications yet</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status Insights</CardTitle>
        <CardDescription>Highlights from your application statuses</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">Most common status</div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-semibold">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[insights.top.status as keyof typeof STATUS_COLORS] }}
                />
                <span>{insights.top.status}</span>
              </div>
              <span className="text-xl font-semibold">{insights.top.count}</span>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-sm text-muted-foreground">Drop-off rate</div>
            <div className="mt-2 text-2xl font-semibold">{insights.rejectionRate}%</div>
            <p className="mt-1 text-xs text-muted-foreground">Rejected or withdrawn applications.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
