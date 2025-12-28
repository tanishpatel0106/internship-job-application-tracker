"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, FileText, Users, CheckSquare, MessageSquare } from "lucide-react"
import { useEffect, useState } from "react"
import { formatDateOnly, formatDateTimeDisplay, isDateOnlyString } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

interface TimelineEvent {
  id: string
  type: "application" | "interview" | "contact" | "task" | "document"
  title: string
  description?: string
  date: string
  status?: string
}

interface ApplicationTimelineProps {
  applicationId: string
}

export function ApplicationTimeline({ applicationId }: ApplicationTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const timeZone = useProfileTimeZone()

  useEffect(() => {
    const fetchTimelineData = async () => {
      try {
        // Fetch all related data
        const [interviewsRes, contactsRes, tasksRes, documentsRes] = await Promise.all([
          fetch(`/api/interview-rounds?application_id=${applicationId}`),
          fetch(`/api/contacts?application_id=${applicationId}`),
          fetch(`/api/tasks?application_id=${applicationId}`),
          fetch(`/api/documents?application_id=${applicationId}`),
        ])

        const [interviews, contacts, tasks, documents] = await Promise.all([
          interviewsRes.ok ? interviewsRes.json() : [],
          contactsRes.ok ? contactsRes.json() : [],
          tasksRes.ok ? tasksRes.json() : [],
          documentsRes.ok ? documentsRes.json() : [],
        ])

        // Convert to timeline events
        const timelineEvents: TimelineEvent[] = [
          ...interviews.map((interview: any) => ({
            id: interview.id,
            type: "interview" as const,
            title: `${interview.interview_type} Interview - Round ${interview.round_number}`,
            description: interview.interviewer_names,
            date: interview.scheduled_date || interview.created_at,
            status: interview.result,
          })),
          ...contacts.map((contact: any) => ({
            id: contact.id,
            type: "contact" as const,
            title: `Added contact: ${contact.name}`,
            description: contact.position
              ? `${contact.position}${contact.company ? ` at ${contact.company}` : ""}`
              : contact.company,
            date: contact.created_at,
          })),
          ...tasks.map((task: any) => ({
            id: task.id,
            type: "task" as const,
            title: task.title,
            description: task.description,
            date: task.due_date || task.created_at,
            status: task.status,
          })),
          ...documents.map((doc: any) => ({
            id: doc.id,
            type: "document" as const,
            title: `Uploaded: ${doc.filename}`,
            date: doc.uploaded_at,
          })),
        ]

        // Sort by date (newest first)
        timelineEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

        setEvents(timelineEvents)
      } catch (error) {
        console.error("Failed to fetch timeline data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchTimelineData()
  }, [applicationId])

  const getEventIcon = (type: string) => {
    switch (type) {
      case "interview":
        return Calendar
      case "contact":
        return Users
      case "task":
        return CheckSquare
      case "document":
        return FileText
      default:
        return MessageSquare
    }
  }

  const getEventColor = (type: string) => {
    switch (type) {
      case "interview":
        return "bg-green-100 text-green-800"
      case "contact":
        return "bg-blue-100 text-blue-800"
      case "task":
        return "bg-orange-100 text-orange-800"
      case "document":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Activity history for this application</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="h-8 w-8 bg-muted rounded-full animate-pulse" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted rounded animate-pulse w-48" />
                  <div className="h-3 bg-muted rounded animate-pulse w-32" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Activity history for this application</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No activity recorded yet</div>
        ) : (
          <div className="space-y-6">
            {events.map((event, index) => {
              const Icon = getEventIcon(event.type)
              return (
                <div key={event.id} className="flex items-start gap-4">
                  <div className="relative">
                    <div className={`p-2 rounded-full ${getEventColor(event.type)}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {index < events.length - 1 && (
                      <div className="absolute top-10 left-1/2 w-px h-6 bg-border -translate-x-1/2" />
                    )}
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{event.title}</h4>
                      {event.status && (
                        <Badge variant="secondary" className="text-xs">
                          {event.status}
                        </Badge>
                      )}
                    </div>
                    {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {isDateOnlyString(event.date)
                        ? formatDateOnly(event.date, timeZone)
                        : formatDateTimeDisplay(event.date, timeZone)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
