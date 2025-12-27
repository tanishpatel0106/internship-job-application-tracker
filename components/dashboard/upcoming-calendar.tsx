"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { addDays, format } from "date-fns"
import { useMemo } from "react"

const DAYS_TO_SHOW = 14

export function UpcomingCalendar() {
  const days = useMemo(() => {
    const today = new Date()
    return Array.from({ length: DAYS_TO_SHOW }, (_, index) => addDays(today, index))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Days</CardTitle>
        <CardDescription>Plan the next two weeks at a glance</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-3">
          {days.map((day, index) => {
            const isToday = index === 0
            return (
              <div
                key={day.toISOString()}
                className={`rounded-lg border px-3 py-2 text-center text-sm ${
                  isToday ? "border-primary bg-primary/10 text-primary" : "bg-card"
                }`}
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {format(day, "EEE")}
                </div>
                <div className="text-lg font-semibold">{format(day, "d")}</div>
                <div className="text-xs text-muted-foreground">{format(day, "MMM")}</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
