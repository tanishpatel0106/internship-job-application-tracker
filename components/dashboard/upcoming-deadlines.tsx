"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { InterviewRound, Task } from "@/lib/types"
import { priorityColors } from "@/components/dashboard/upcoming-tasks"

type DeadlineItem = {
  id: string
  title: string
  date: string
  type: "Task" | "Interview"
  link: string
}

const maxItems = 6

const typeBadgeStyles: Record<DeadlineItem["type"], string> = {
  Task: priorityColors.Medium,
  Interview: priorityColors.High,
}

const normalizeTasks = (tasks: Task[]): DeadlineItem[] =>
  tasks
    .filter((task) => Boolean(task.due_date))
    .map((task) => ({
      id: task.id,
      title: task.title,
      date: task.due_date as string,
      type: "Task",
      link: "/dashboard/tasks",
    }))

const normalizeInterviews = (interviews: InterviewRound[]): DeadlineItem[] =>
  interviews
    .filter((interview) => Boolean(interview.scheduled_date))
    .map((interview) => ({
      id: interview.id,
      title: `Interview · ${interview.interview_type}`,
      date: interview.scheduled_date as string,
      type: "Interview",
      link: "/dashboard/interviews",
    }))

export function UpcomingDeadlines() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [interviews, setInterviews] = useState<InterviewRound[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchUpcoming = async () => {
      try {
        const [tasksResponse, interviewsResponse] = await Promise.all([
          fetch("/api/tasks?status=Pending"),
          fetch("/api/interview-rounds"),
        ])

        if (tasksResponse.ok) {
          const data = await tasksResponse.json()
          setTasks(Array.isArray(data) ? data : data.data || [])
        }

        if (interviewsResponse.ok) {
          const data = await interviewsResponse.json()
          setInterviews(Array.isArray(data) ? data : data.data || [])
        }
      } catch (error) {
        console.error("Failed to fetch upcoming items:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchUpcoming()
  }, [])

  const upcomingItems = useMemo(() => {
    const combined = [...normalizeTasks(tasks), ...normalizeInterviews(interviews)]

    return combined
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, maxItems)
  }, [tasks, interviews])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Deadlines</CardTitle>
          <CardDescription>Next tasks and interviews</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="space-y-1">
                  <div className="h-4 bg-muted rounded animate-pulse w-32" />
                  <div className="h-3 bg-muted rounded animate-pulse w-24" />
                </div>
                <div className="h-6 bg-muted rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Upcoming Deadlines</CardTitle>
          <CardDescription>Next tasks and interviews</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/tasks">View All</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {upcomingItems.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-muted-foreground">No upcoming tasks or interviews</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button asChild size="sm">
                <Link href="/dashboard/tasks/new">Add Task</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/interviews/new">Schedule Interview</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {upcomingItems.map((item) => (
              <div key={`${item.type}-${item.id}`} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(item.date).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={typeBadgeStyles[item.type]} variant="secondary">
                    {item.type}
                  </Badge>
                  <Button asChild size="sm" variant="ghost" className="h-8 px-2">
                    <Link href={item.link}>Open</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
