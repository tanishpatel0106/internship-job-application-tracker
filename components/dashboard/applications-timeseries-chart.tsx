"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { useEffect, useState } from "react"

const formatAxisDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const formatTooltipDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

type TimeseriesPoint = {
  date: string
  count: number
  cumulative: number
}

export function ApplicationsTimeseriesChart() {
  const [data, setData] = useState<TimeseriesPoint[]>([])
  const [todayCount, setTodayCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

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
          <CardDescription>Daily application volume for the last 90 days</CardDescription>
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
          <CardDescription>Daily application volume for the last 90 days</CardDescription>
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
          Daily application volume for the last 90 days · Today: {todayCount}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            count: {
              label: "Daily",
              color: "var(--chart-1)",
            },
            cumulative: {
              label: "Cumulative",
              color: "var(--chart-2)",
            },
          }}
          className="h-[340px] w-full aspect-auto"
        >
          <LineChart data={data} margin={{ left: 12, right: 24, top: 10, bottom: 12 }}>
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
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--color-count)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-count)" }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="var(--color-cumulative)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
