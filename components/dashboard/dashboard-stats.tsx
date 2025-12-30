"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

interface DashboardKpi {
  id: string
  title: string
  value: string | number
  description: string
  changePct: number
  trend: number[]
  progress?: number
}

interface DashboardStatsData {
  kpis: DashboardKpi[]
}

const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data || data.length < 2) {
    return null
  }

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100
      const y = 32 - ((value - min) / range) * 32
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  )
}

const ProgressRing = ({ value }: { value: number }) => {
  const size = 32
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(Math.max(value, 0), 1)
  const offset = circumference - progress * circumference

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="hsl(var(--border))"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="hsl(var(--primary))"
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

export function DashboardStats() {
  const [stats, setStats] = useState<DashboardStatsData>({ kpis: [] })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/dashboard/stats")
        if (response.ok) {
          const data = await response.json()
          setStats({ kpis: data.kpis || [] })
        }
      } catch (error) {
        console.error("Failed to fetch dashboard stats:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  const kpis = useMemo(() => stats.kpis, [stats.kpis])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
        {Array.from({ length: 10 }).map((_, i) => (
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
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
      {kpis.map((stat) => {
        const changePositive = stat.changePct >= 0
        const changeColor = changePositive ? "text-emerald-500" : "text-rose-500"
        const changeIcon = changePositive ? ArrowUpRight : ArrowDownRight
        const ChangeIcon = changeIcon
        const changeLabel = `${Math.abs(stat.changePct)}%`

        return (
          <Card key={stat.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              {stat.progress !== undefined ? <ProgressRing value={stat.progress} /> : <TrendingUp className="h-4 w-4 text-muted-foreground" />}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
              <div className="flex items-center justify-between gap-3">
                <div className={cn("flex items-center text-xs font-medium", changeColor)}>
                  <ChangeIcon className="h-3.5 w-3.5" />
                  <span>{changeLabel}</span>
                </div>
                <div className="flex-1">
                  <Sparkline data={stat.trend} color={changePositive ? "#10b981" : "#f43f5e"} />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
