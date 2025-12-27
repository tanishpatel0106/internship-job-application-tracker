"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useMemo, useState } from "react"
import { ResponsiveContainer, Sankey, Tooltip } from "recharts"

const COLORS = {
  Applied: "#3b82f6",
  "Interview Scheduled": "#10b981",
  "Interview Completed": "#f59e0b",
  "Offer Received": "#22c55e",
  Rejected: "#ef4444",
  Withdrawn: "#6b7280",
  "Rejected After Interview": "#dc2626",
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

type FlowNode = {
  name: string
  color: string
}

type FlowLink = {
  source: number
  target: number
  value: number
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

const SankeyNode = ({ x, y, width, height, index, payload }: any) => {
  const fill = payload.color || "#94a3b8"
  const labelX = x + width + 8
  const labelY = y + height / 2

  return (
    <g key={`node-${index}`}>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} />
      <text x={labelX} y={labelY} textAnchor="start" dominantBaseline="middle" fill="#64748b">
        {payload.name}
      </text>
    </g>
  )
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

  const rejectedAfterInterview = flow.dropOffs.rejectedAfterInterview
  const rejectedBeforeInterview = Math.max(0, flow.dropOffs.rejected - rejectedAfterInterview)
  const totalApplications =
    flow.stages.applied +
    flow.stages.interviewScheduled +
    flow.stages.interviewCompleted +
    flow.stages.offerReceived +
    flow.dropOffs.rejected +
    flow.dropOffs.withdrawn

  const interviewScheduledReached = Math.max(
    0,
    totalApplications - flow.stages.applied - flow.dropOffs.rejected - flow.dropOffs.withdrawn,
  )
  const interviewCompletedReached = Math.max(0, flow.stages.interviewCompleted + flow.stages.offerReceived)

  const sankeyData = useMemo(() => {
    const nodes: FlowNode[] = [
      { name: "Applied", color: COLORS.Applied },
      { name: "Interview Scheduled", color: COLORS["Interview Scheduled"] },
      { name: "Interview Completed", color: COLORS["Interview Completed"] },
      { name: "Offer Received", color: COLORS["Offer Received"] },
      { name: "Rejected", color: COLORS.Rejected },
      { name: "Withdrawn", color: COLORS.Withdrawn },
      { name: "Rejected After Interview", color: COLORS["Rejected After Interview"] },
    ]

    const links: FlowLink[] = [
      { source: 0, target: 1, value: interviewScheduledReached },
      { source: 0, target: 4, value: rejectedBeforeInterview },
      { source: 0, target: 5, value: flow.dropOffs.withdrawn },
      { source: 1, target: 2, value: interviewCompletedReached },
      { source: 2, target: 3, value: flow.stages.offerReceived },
      { source: 2, target: 6, value: rejectedAfterInterview },
    ].filter((link) => link.value > 0)

    return { nodes, links }
  }, [flow, interviewCompletedReached, interviewScheduledReached, rejectedAfterInterview, rejectedBeforeInterview])

  const totalCount = useMemo(() => {
    const stageTotal = Object.values(flow.stages).reduce((sum, value) => sum + value, 0)
    const dropOffTotal = Object.values(flow.dropOffs).reduce((sum, value) => sum + value, 0)
    return stageTotal + dropOffTotal
  }, [flow])

  const dropOffItems = [
    { label: "Rejected", value: flow.dropOffs.rejected, color: COLORS.Rejected },
    { label: "Withdrawn", value: flow.dropOffs.withdrawn, color: COLORS.Withdrawn },
    {
      label: "Rejected After Interview",
      value: flow.dropOffs.rejectedAfterInterview,
      color: COLORS["Rejected After Interview"],
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
          <div className="h-[320px] flex items-center justify-center">
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
          <div className="h-[320px] flex items-center justify-center">
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
        <CardDescription>Stage transitions and drop-offs for your pipeline</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey data={sankeyData} nodePadding={28} nodeWidth={12} node={<SankeyNode />}> 
                <Tooltip />
              </Sankey>
            </ResponsiveContainer>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-sm font-semibold text-muted-foreground">Drop-offs</div>
              <div className="mt-4 space-y-3">
                {dropOffItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span>{item.label}</span>
                    </div>
                    <div className="text-base font-semibold">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm text-muted-foreground">Applications tracked</div>
              <div className="mt-2 text-2xl font-semibold">{totalApplications}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Flow counts are inferred from current statuses and interview outcomes.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
