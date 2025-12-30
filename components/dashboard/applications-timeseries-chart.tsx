"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useEffect, useState } from "react"
import { formatDateOnlyWithOptions } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

type TimeseriesPoint = {
  date: string
  count: number
  cumulative: number
}

export function ApplicationsTimeseriesChart() {
  const [data, setData] = useState<TimeseriesPoint[]>([])
  const [todayCount, setTodayCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const timeZone = useProfileTimeZone()

  const formatAxisDate = (value: string) =>
    formatDateOnlyWithOptions(value, timeZone, { month: "short", day: "numeric" })
  const formatTooltipDate = (value: string) =>
    formatDateOnlyWithOptions(value, timeZone, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/dashboard/applications-timeseries")
        if (response.ok) {
          const payload = await response.json()
          setData(payload.series || [])
          setTodayCount(payload.todayCount || 0)
        }
      } catch (error) {
        console.error("Failed to fetch time series data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Applications Over Time</CardTitle>
          <CardDescription>Daily application volume for the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading chart...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Applications Over Time</CardTitle>
          <CardDescription>Daily application volume for the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">No applications yet</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Applications Over Time</CardTitle>
        <CardDescription>
          Daily application volume for the last 30 days · Today: {todayCount}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-8">
          <ChartContainer
            config={{
              count: {
                label: "Daily",
                color: "var(--chart-1)",
              },
            }}
            className="h-[180px] w-full aspect-auto"
          >
            <BarChart data={data} margin={{ left: 12, right: 24, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} tickLine={false} axisLine={false} hide />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={formatTooltipDate} />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <ChartContainer
            config={{
              cumulative: {
                label: "Cumulative",
                color: "var(--chart-2)",
              },
            }}
            className="h-[180px] w-full aspect-auto"
          >
            <AreaChart data={data} margin={{ left: 12, right: 24, top: 8, bottom: 12 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatAxisDate}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={formatTooltipDate} />} />
              <Area
                type="stepAfter"
                dataKey="cumulative"
                stroke="var(--color-cumulative)"
                strokeWidth={2}
                fill="var(--color-cumulative)"
                fillOpacity={0.15}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  )
}
