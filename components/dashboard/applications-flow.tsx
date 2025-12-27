"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useMemo, useState } from "react"

const STAGE_COLORS: Record<string, string> = {
  Applied: "#3b82f6",
  "Interview Scheduled": "#10b981",
  "Interview Completed": "#f59e0b",
  "Offer Received": "#22c55e",
}

type StageCount = {
  stage: string
  count: number
}

type FlowResponse = {
  stages: StageCount[]
  rejectedAfterInterview: number
}

export function ApplicationsFlow() {
  const [data, setData] = useState<FlowResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/dashboard/conversion-flow")
        if (response.ok) {
          const payload = (await response.json()) as FlowResponse
          setData(payload)
        }
      } catch (error) {
        console.error("Failed to fetch conversion flow data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  const maxCount = useMemo(() => {
    if (!data) return 0
    return Math.max(0, ...data.stages.map((stage) => stage.count), data.rejectedAfterInterview)
  }, [data])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application Flow</CardTitle>
          <CardDescription>Progress through your hiring stages</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading flow...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data || (data.stages.every((stage) => stage.count === 0) && data.rejectedAfterInterview === 0)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application Flow</CardTitle>
          <CardDescription>Progress through your hiring stages</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] flex items-center justify-center">
            <div className="text-muted-foreground">No applications yet</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Flow</CardTitle>
        <CardDescription>Progress through your hiring stages</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {data.stages.map((stage) => {
              const width = maxCount > 0 ? Math.max(12, Math.round((stage.count / maxCount) * 100)) : 0
              const color = STAGE_COLORS[stage.stage] || "#6b7280"

              return (
                <div key={stage.stage} className="flex items-center gap-3">
                  <span className="w-36 text-sm text-muted-foreground">{stage.stage}</span>
                  <div className="flex-1">
                    <div className="h-8 rounded-md bg-muted">
                      <div
                        className="h-8 rounded-md transition-all"
                        style={{ width: `${width}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                  <span className="w-10 text-right font-mono text-sm text-foreground">{stage.count}</span>
                </div>
              )}
            )}
          </div>
          <div className="flex h-full flex-col justify-center">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Rejected after interview</p>
              <p className="mt-2 text-3xl font-semibold text-red-700">{data.rejectedAfterInterview}</p>
              <p className="mt-1 text-xs text-muted-foreground">Rejected applications with at least one interview.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
