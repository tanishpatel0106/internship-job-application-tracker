"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Calendar, Clock, Pencil, Trash, Link as LinkIcon } from "lucide-react"
import Link from "next/link"
import type { InterviewRound } from "@/lib/types"
import { formatDateTimeDisplay } from "@/lib/date"
import { useProfileTimeZone } from "@/lib/hooks/use-profile-time-zone"

const resultColors: Record<string, string> = {
  Passed: "bg-green-100 text-green-800",
  Failed: "bg-red-100 text-red-800",
  Pending: "bg-yellow-100 text-yellow-800",
  Cancelled: "bg-gray-100 text-gray-800",
}

export function InterviewsPageView() {
  const [interviews, setInterviews] = useState<InterviewRound[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const timeZone = useProfileTimeZone()

  const fetchInterviews = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/interview-rounds")
      if (response.ok) {
        const data = await response.json()
        setInterviews(Array.isArray(data) ? data : data.data || [])
      }
    } catch (error) {
      console.error("Failed to fetch interviews:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchInterviews()
  }, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this interview?")) return
    try {
      const response = await fetch(`/api/interview-rounds/${id}`, { method: "DELETE" })
      if (response.ok) {
        setInterviews((prev) => prev.filter((i) => i.id !== id))
      }
    } catch (error) {
      console.error("Failed to delete interview:", error)
    }
  }

  const filteredInterviews = interviews.filter(
    (interview) =>
      interview.interview_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (interview.interviewer_names || "").toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const upcomingInterviews = filteredInterviews.filter(
    (interview) => interview.scheduled_date && new Date(interview.scheduled_date) > new Date(),
  )
  const pastInterviews = filteredInterviews.filter(
    (interview) => !interview.scheduled_date || new Date(interview.scheduled_date) <= new Date(),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-balance">Interviews</h1>
          <p className="text-muted-foreground text-pretty">Track all your interview rounds and their outcomes.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/interviews/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Interview
          </Link>
        </Button>
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search interviews..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredInterviews.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="space-y-4">
              <div className="text-muted-foreground">
                {searchTerm ? "No interviews match your search" : "No interviews yet"}
              </div>
              <Button asChild>
                <Link href="/dashboard/interviews/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Interview
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {upcomingInterviews.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Upcoming Interviews ({upcomingInterviews.length})</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {upcomingInterviews.map((interview) => (
                  <Card key={interview.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>Round {interview.round_number}</span>
                        {interview.result && (
                          <Badge className={resultColors[interview.result]} variant="secondary">
                            {interview.result}
                          </Badge>
                        )}
                      </CardTitle>
                      {interview.interviewer_names && (
                        <CardDescription>with {interview.interviewer_names}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {interview.scheduled_date && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4 mr-2" />
                            {formatDateTimeDisplay(interview.scheduled_date, timeZone)}
                          </div>
                        )}
                        {interview.duration_minutes && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 mr-2" />
                            {interview.duration_minutes} minutes
                          </div>
                        )}
                        {interview.notes && (
                          <p className="text-sm text-muted-foreground mt-2">{interview.notes}</p>
                        )}
                      </div>
                      <div className="flex justify-end space-x-1 mt-4">
                        {interview.application_id && (
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/dashboard/applications/${interview.application_id}`}>
                              <LinkIcon className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/dashboard/interviews/${interview.id}/edit`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(interview.id)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {pastInterviews.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Past Interviews ({pastInterviews.length})</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {pastInterviews.map((interview) => (
                  <Card key={interview.id} className="opacity-75">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>Round {interview.round_number}</span>
                        {interview.result && (
                          <Badge className={resultColors[interview.result]} variant="secondary">
                            {interview.result}
                          </Badge>
                        )}
                      </CardTitle>
                      {interview.interviewer_names && (
                        <CardDescription>with {interview.interviewer_names}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {interview.scheduled_date && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4 mr-2" />
                            {formatDateTimeDisplay(interview.scheduled_date, timeZone)}
                          </div>
                        )}
                        {interview.duration_minutes && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 mr-2" />
                            {interview.duration_minutes} minutes
                          </div>
                        )}
                        {interview.notes && (
                          <p className="text-sm text-muted-foreground mt-2">{interview.notes}</p>
                        )}
                      </div>
                      <div className="flex justify-end space-x-1 mt-4">
                        {interview.application_id && (
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/dashboard/applications/${interview.application_id}`}>
                              <LinkIcon className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/dashboard/interviews/${interview.id}/edit`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(interview.id)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
