"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Calendar, Clock, MapPin } from "lucide-react"
import Link from "next/link"
import type { InterviewRound } from "@/lib/types"

const statusColors = {
  Scheduled: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
}

export function InterviewsPageView() {
  const [interviews, setInterviews] = useState<InterviewRound[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const fetchInterviews = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/interview-rounds")
      if (response.ok) {
        const data = await response.json()
        setInterviews(data.data || [])
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

  const filteredInterviews = interviews.filter(
    (interview) =>
      interview.round_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      interview.interviewer_name?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const upcomingInterviews = filteredInterviews.filter(
    (interview) => interview.status === "Scheduled" && new Date(interview.scheduled_date) > new Date(),
  )
  const pastInterviews = filteredInterviews.filter(
    (interview) => interview.status !== "Scheduled" || new Date(interview.scheduled_date) <= new Date(),
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
                        <span>{interview.round_name}</span>
                        <Badge className={statusColors[interview.status]} variant="secondary">
                          {interview.status}
                        </Badge>
                      </CardTitle>
                      {interview.interviewer_name && (
                        <CardDescription>with {interview.interviewer_name}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4 mr-2" />
                          {new Date(interview.scheduled_date).toLocaleDateString()}
                        </div>
                        {interview.scheduled_time && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 mr-2" />
                            {interview.scheduled_time}
                          </div>
                        )}
                        {interview.location && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <MapPin className="h-4 w-4 mr-2" />
                            {interview.location}
                          </div>
                        )}
                        {interview.notes && <p className="text-sm text-muted-foreground mt-2">{interview.notes}</p>}
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
                        <span>{interview.round_name}</span>
                        <Badge className={statusColors[interview.status]} variant="secondary">
                          {interview.status}
                        </Badge>
                      </CardTitle>
                      {interview.interviewer_name && (
                        <CardDescription>with {interview.interviewer_name}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4 mr-2" />
                          {new Date(interview.scheduled_date).toLocaleDateString()}
                        </div>
                        {interview.scheduled_time && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 mr-2" />
                            {interview.scheduled_time}
                          </div>
                        )}
                        {interview.location && (
                          <div className="flex items-center text-sm text-muted-foreground">
                            <MapPin className="h-4 w-4 mr-2" />
                            {interview.location}
                          </div>
                        )}
                        {interview.notes && <p className="text-sm text-muted-foreground mt-2">{interview.notes}</p>}
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
