"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfWeek,
  subWeeks,
} from "date-fns"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { InterviewRound, Task } from "@/lib/types"
import { getDateInTimeZone } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

const WEEKS_PER_PAGE = 2

const getDateKey = (date: Date) => format(date, "yyyy-MM-dd")

type CalendarItem = {
  id: string
  type: "Task" | "Interview"
  title: string
  date: Date
  href: string
}

export function UpcomingCalendar() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [interviews, setInterviews] = useState<InterviewRound[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [isLoading, setIsLoading] = useState(true)
  const timeZone = useProfileTimeZone()

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const [tasksResponse, interviewsResponse] = await Promise.all([
          fetch("/api/tasks?status=Pending"),
          fetch("/api/interview-rounds"),
        ])

        if (tasksResponse.ok) {
          const data = await tasksResponse.json()
          setTasks(data)
        }

        if (interviewsResponse.ok) {
          const data = await interviewsResponse.json()
          setInterviews(data)
        }
      } catch (error) {
        console.error("Failed to fetch calendar items:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchItems()
  }, [])

  const range = useMemo(() => {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 })
    const end = endOfWeek(addWeeks(start, WEEKS_PER_PAGE - 1), { weekStartsOn: 1 })
    return { start, end }
  }, [weekStart])

  const itemsByDate = useMemo(() => {
    const items: CalendarItem[] = []

    tasks.forEach((task) => {
      if (!task.due_date) return
      const dueDate = new Date(task.due_date)
      if (Number.isNaN(dueDate.getTime())) return
      if (!isWithinInterval(dueDate, { start: range.start, end: range.end })) return
      items.push({
        id: task.id,
        type: "Task",
        title: task.title,
        date: dueDate,
        href: "/dashboard/tasks",
      })
    })

    interviews.forEach((interview) => {
      if (!interview.scheduled_date) return
      const scheduledDate = getDateInTimeZone(interview.scheduled_date, timeZone)
      if (!scheduledDate) return
      if (!isWithinInterval(scheduledDate, { start: range.start, end: range.end })) return
      items.push({
        id: interview.id,
        type: "Interview",
        title: `Interview · ${interview.interview_type}`,
        date: scheduledDate,
        href: "/dashboard/interviews",
      })
    })

    const mapped = items.reduce<Record<string, CalendarItem[]>>((acc, item) => {
      const key = getDateKey(item.date)
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {})

    Object.values(mapped).forEach((list) => {
      list.sort((a, b) => a.date.getTime() - b.date.getTime())
    })

    return mapped
  }, [tasks, interviews, range, timeZone])

  const weeks = useMemo(() => {
    const weekList: Date[][] = []
    let cursor = range.start
    while (cursor <= range.end) {
      const week: Date[] = []
      for (let i = 0; i < 7; i += 1) {
        week.push(addDays(cursor, i))
      }
      weekList.push(week)
      cursor = addDays(cursor, 7)
    }
    return weekList
  }, [range])

  const selectedItems = useMemo(() => {
    return itemsByDate[getDateKey(selectedDate)] || []
  }, [itemsByDate, selectedDate])

  useEffect(() => {
    if (isWithinInterval(selectedDate, { start: range.start, end: range.end })) {
      return
    }
    setSelectedDate(range.start)
  }, [range, selectedDate])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>Upcoming tasks and interviews</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading calendar...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Calendar</CardTitle>
            <CardDescription>Two-week view with tasks and interviews</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekStart((current) => subWeeks(current, WEEKS_PER_PAGE))}
            >
              Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(new Date())}>
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekStart((current) => addWeeks(current, WEEKS_PER_PAGE))}
            >
              Next
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {weeks.map((week, index) => (
            <div key={`week-${index}`} className="grid grid-cols-7 gap-2">
              {week.map((day) => {
                const key = getDateKey(day)
                const isSelected = isSameDay(day, selectedDate)
                const items = itemsByDate[key] || []
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={`rounded-lg border px-2 py-2 text-center text-xs transition ${
                      isSelected ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {format(day, "EEE")}
                    </div>
                    <div className="text-base font-semibold">{format(day, "d")}</div>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      {items.length > 0 ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {items.length}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-semibold">{format(selectedDate, "EEEE, MMM d")}</div>
          {selectedItems.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No tasks or interviews scheduled.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {selectedItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.type} · {format(item.date, "p")}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.href}>Open</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
