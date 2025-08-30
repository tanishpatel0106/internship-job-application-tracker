"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Calendar, Clock, User, AlertCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { InterviewRoundForm } from "./interview-round-form"
import type { InterviewRound } from "@/lib/types"

interface InterviewRoundsTabProps {
  applicationId: string
}

const typeColors = {
  "Phone Screen": "bg-blue-100 text-blue-800",
  Technical: "bg-purple-100 text-purple-800",
  Behavioral: "bg-green-100 text-green-800",
  Panel: "bg-orange-100 text-orange-800",
  Final: "bg-red-100 text-red-800",
  Other: "bg-gray-100 text-gray-800",
}

const resultColors = {
  Passed: "bg-green-100 text-green-800",
  Failed: "bg-red-100 text-red-800",
  Pending: "bg-yellow-100 text-yellow-800",
  Cancelled: "bg-gray-100 text-gray-800",
}

export function InterviewRoundsTab({ applicationId }: InterviewRoundsTabProps) {
  const [interviews, setInterviews] = useState<InterviewRound[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingInterview, setEditingInterview] = useState<InterviewRound | null>(null)

  const fetchInterviews = async () => {
    try {
      setError(null)
      console.log("[v0] Fetching interviews for application:", applicationId)
      const response = await fetch(`/api/interview-rounds?application_id=${applicationId}`)
      console.log("[v0] Interview rounds API response status:", response.status)

      if (response.ok) {
        const data = await response.json()
        console.log("[v0] Interview rounds data received:", data)
        setInterviews(data)
      } else {
        const errorData = await response.text()
        console.error("[v0] Interview rounds API error:", response.status, errorData)
        setError(`Failed to load interviews: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.error("[v0] Failed to fetch interviews:", error)
      setError("Failed to load interviews. Please check your connection.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchInterviews()
  }, [applicationId])

  const handleFormComplete = () => {
    setShowForm(false)
    setEditingInterview(null)
    fetchInterviews()
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse w-32" />
                <div className="h-3 bg-muted rounded animate-pulse w-48" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
          <h3 className="text-lg font-semibold mb-2 text-red-600">Error Loading Interviews</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchInterviews} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (showForm || editingInterview) {
    return (
      <InterviewRoundForm
        applicationId={applicationId}
        initialData={editingInterview}
        onComplete={handleFormComplete}
        onCancel={() => {
          setShowForm(false)
          setEditingInterview(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Interview Rounds</h3>
          <p className="text-sm text-muted-foreground">Track your interview progress</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Interview
        </Button>
      </div>

      {interviews.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No interviews scheduled</h3>
            <p className="text-muted-foreground mb-4">Add your first interview round to track your progress.</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Interview
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {interviews.map((interview) => (
            <Card key={interview.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="p-6" onClick={() => setEditingInterview(interview)}>
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">Round {interview.round_number}</h4>
                      <Badge className={typeColors[interview.interview_type]} variant="secondary">
                        {interview.interview_type}
                      </Badge>
                      {interview.result && (
                        <Badge className={resultColors[interview.result]} variant="secondary">
                          {interview.result}
                        </Badge>
                      )}
                    </div>

                    {interview.scheduled_date && (
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {new Date(interview.scheduled_date).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {new Date(interview.scheduled_date).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        {interview.duration_minutes && <span>({interview.duration_minutes} min)</span>}
                      </div>
                    )}

                    {interview.interviewer_names && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <User className="h-4 w-4" />
                        {interview.interviewer_names}
                      </div>
                    )}

                    {interview.notes && <p className="text-sm text-muted-foreground">{interview.notes}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
