"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Clock, Calendar, TrendingUp } from "lucide-react"
import { useEffect, useState } from "react"

interface DashboardStatsData {
  totalApplications: number
  pendingTasks: number
  upcomingInterviews: number
  responseRate: number
  statusBreakdown?: Record<string, number>
}

export function DashboardStats() {
  const [stats, setStats] = useState<DashboardStatsData>({
    totalApplications: 0,
    pendingTasks: 0,
    upcomingInterviews: 0,
    responseRate: 0,
    statusBreakdown: {},
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/dashboard/stats")
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        }
      } catch (error) {
        console.error("Failed to fetch dashboard stats:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  const statusBreakdown = stats.statusBreakdown || {}
  const rejectedCount = statusBreakdown["Rejected"] || 0
  const withdrawnCount = statusBreakdown["Withdrawn"] || 0
  const offerCount = statusBreakdown["Offer Received"] || 0
  const interviewCount =
    (statusBreakdown["Interview Scheduled"] || 0) + (statusBreakdown["Interview Completed"] || 0)
  const activePipeline = Math.max(0, stats.totalApplications - rejectedCount - withdrawnCount)
  const statCards = [
    {
      title: "Total Applications",
      value: stats.totalApplications,
      icon: FileText,
      description: "Applications submitted",
    },
    {
      title: "Active Pipeline",
      value: activePipeline,
      icon: TrendingUp,
      description: "Still in progress",
    },
    {
      title: "Pending Tasks",
      value: stats.pendingTasks,
      icon: Clock,
      description: "Tasks to complete",
    },
    {
      title: "Upcoming Interviews",
      value: stats.upcomingInterviews,
      icon: Calendar,
      description: "Scheduled interviews",
    },
    {
      title: "Interview Stages",
      value: interviewCount,
      icon: Calendar,
      description: "Scheduled + completed",
    },
    {
      title: "Offers Received",
      value: offerCount,
      icon: FileText,
      description: "Offers in hand",
    },
    {
      title: "Response Rate",
      value: `${stats.responseRate}%`,
      icon: TrendingUp,
      description: "Progressed beyond applied",
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <div className="h-4 bg-muted rounded animate-pulse" />
              </CardTitle>
              <div className="h-4 w-4 bg-muted rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded animate-pulse mb-1" />
              <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-6">
      {statCards.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
