"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useMemo, useState } from "react"

const COLORS = {
  Applied: "#3b82f6",
  "Interview Scheduled": "#10b981",
  "Interview Completed": "#f59e0b",
  "Offer Received": "#22c55e",
  Rejected: "#ef4444",
  Withdrawn: "#6b7280",
}

type ApplicationFlowResponse = {
  stages: {
    applied: number
    interviewScheduled: number
    interviewCompleted: number
    offerReceived: number
  }
  dropOffs: {
    rejected: number
    withdrawn: number
    rejectedAfterInterview: number
  }
}

const EMPTY_FLOW: ApplicationFlowResponse = {
  stages: {
    applied: 0,
    interviewScheduled: 0,
    interviewCompleted: 0,
    offerReceived: 0,
  },
  dropOffs: {
    rejected: 0,
    withdrawn: 0,
    rejectedAfterInterview: 0,
  },
}

export function ApplicationsFlowDiagram() {
  const [flow, setFlow] = useState<ApplicationFlowResponse>(EMPTY_FLOW)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const response = await fetch("/api/dashboard/application-flow")
        if (response.ok) {
          const payload = (await response.json()) as ApplicationFlowResponse
          setFlow(payload)
        }
      } catch (error) {
        console.error("Failed to fetch application flow:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchFlow()
  }, [])

  const totalCount = useMemo(() => {
    const stageTotal = Object.values(flow.stages).reduce((sum, value) => sum + value, 0)
    const dropOffTotal = Object.values(flow.dropOffs).reduce((sum, value) => sum + value, 0)
    return stageTotal + dropOffTotal
  }, [flow])

  const stageItems = [
    { label: "Applied", value: flow.stages.applied, color: COLORS.Applied },
    { label: "Interview Scheduled", value: flow.stages.interviewScheduled, color: COLORS["Interview Scheduled"] },
    { label: "Interview Completed", value: flow.stages.interviewCompleted, color: COLORS["Interview Completed"] },
    { label: "Offer Received", value: flow.stages.offerReceived, color: COLORS["Offer Received"] },
  ]

  const dropOffItems = [
    { label: "Rejected", value: flow.dropOffs.rejected, color: COLORS.Rejected },
    { label: "Withdrawn", value: flow.dropOffs.withdrawn, color: COLORS.Withdrawn },
    {
      label: "Rejected After Interview",
      value: flow.dropOffs.rejectedAfterInterview,
      color: COLORS.Rejected,
    },
  ]

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application Flow</CardTitle>
          <CardDescription>How applications are moving through each stage</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading flow...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (totalCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application Flow</CardTitle>
          <CardDescription>How applications are moving through each stage</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] flex items-center justify-center">
            <div className="text-muted-foreground">No application flow data yet</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Flow</CardTitle>
        <CardDescription>Stage progression and drop-offs for your pipeline</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stageItems.map((item, index) => (
              <div
                key={item.label}
                className="relative rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
                <div className="mt-3 text-2xl font-semibold">{item.value}</div>
                {index < stageItems.length - 1 ? (
                  <span className="absolute right-4 top-4 text-muted-foreground">→</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-sm font-semibold text-muted-foreground">Drop-offs</div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {dropOffItems.map((item) => (
                <div key={item.label} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                  </div>
                  <div className="mt-2 text-xl font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
